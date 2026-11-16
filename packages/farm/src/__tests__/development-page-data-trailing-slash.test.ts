// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * With `trailingSlash`, a document request for '/about' answers with a 308 to '/about/', in
 * development and production. Development page data rendered '/about' instead, so a navigation
 * that reached it (a `redirect("/about")`, a hand-written href) stayed at the non-canonical URL
 * where production lands on '/about/'.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const temporaryRoots = new Set<string>();
const servers = new Set<ViteDevServer>();

afterEach(async () => {
  await Promise.all([...servers].map((server) => server.close()));
  servers.clear();
  await Promise.all(
    [...temporaryRoots].map((root) =>
      fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }),
    ),
  );
  temporaryRoots.clear();
});

async function startApp(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-page-data-slash-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  const files: Record<string, string> = {
    "package.json": '{"private":true,"type":"module"}',
    "farm.config.ts": `export default { trailingSlash: true, images: { provider: "none" }, telemetry: false };`,
    "src/app/layout.tsx": `export default function Layout({ children }) { return <>{children}</>; }`,
    "src/app/page.tsx": `export default function Page() { return <main>home</main>; }`,
    "src/app/about/page.tsx": `export default function Page() { return <main>about</main>; }`,
    "src/app/go/page.tsx": `import { redirect } from "@farm.js/core";
export default function Page() { redirect("/about?from=go"); }`,
  };
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

const pageData = (origin: string, target: string) =>
  fetch(`${origin}/__farm/page-data?path=${encodeURIComponent(target)}`);

describe("development page data with trailingSlash", () => {
  it("redirects to the canonical URL a document request redirects to", async () => {
    const origin = await startApp();

    const document = await fetch(`${origin}/about?from=go`, { redirect: "manual" });
    expect(document.status).toBe(308);
    expect(document.headers.get("location")).toBe("/about/?from=go");

    const redirected = await pageData(origin, "/about?from=go");
    expect(redirected.headers.get("x-farm-navigation")).toBe("redirect");
    expect(await redirected.json()).toEqual({
      redirect: { location: "/about/?from=go", status: 308 },
    });

    // A page's redirect() target is followed the same way.
    const go = await pageData(origin, "/go/");
    expect(await go.json()).toEqual({ redirect: { location: "/about?from=go", status: 307 } });

    const canonical = await pageData(origin, "/about/?from=go");
    expect(canonical.status).toBe(200);
    expect(canonical.headers.get("x-farm-navigation")).not.toBe("redirect");
    expect(await canonical.text()).toContain("about");

    // A miss still answers not found, as its document does.
    expect((await pageData(origin, "/missing")).status).toBe(404);
  }, 60_000);
});
