// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ViteDevServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

/**
 * In islands mode a POST to a page loads the page's modules before checking for a form action.
 * The development renderer then built a second Request over the Node request's body stream, which
 * the first one had already started reading while those modules loaded. That threw, so the first
 * POST to a page after the server started (or after the page changed) answered 500 and the action
 * never ran.
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

const files: Record<string, string> = {
  "package.json": '{"type":"module","private":true}',
  "farm.config.ts": `export default { images: { provider: "none" }, telemetry: false, experimental: { serverComponents: true } };`,
  "src/app/layout.tsx":
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  "src/actions.ts": `"use server";
import { redirect } from "@farm.js/core/navigation";
export async function save(form: FormData) {
  redirect("/done?title=" + encodeURIComponent(String(form.get("title"))));
}`,
  "src/app/page.tsx": `import { save } from "../actions";
export default function Page() {
  return <main><form action={save}><input name="title" defaultValue="Milk" /><button>save</button></form></main>;
}`,
  "src/app/done/page.tsx": "export default function Done() { return <h1>done</h1>; }",
};

async function createApp(): Promise<string> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-islands-cold-post-")),
  );
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  for (const [relativePath, source] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  return root;
}

async function startServer(root: string): Promise<{ origin: string; server: ViteDevServer }> {
  const server = await createServer({ root });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return { origin: `http://localhost:${address.port}`, server };
}

describe("a development islands page's first POST", () => {
  it("runs the form action before the page's modules were loaded", async () => {
    const root = await createApp();

    // The action's id, read from the page a first server renders.
    const first = await startServer(root);
    const html = await (await fetch(`${first.origin}/`)).text();
    const actionId = /name="\$F_0:A" value="([^"]+)"/.exec(html)?.[1];
    expect(actionId).toBeTruthy();
    await first.server.close();
    servers.delete(first.server);

    // A fresh server has loaded no page module yet: the POST is its first request.
    const { origin } = await startServer(root);
    const form = new FormData();
    form.append("$F_REF_0", "");
    form.append("$F_0:A", actionId!);
    form.append("title", "Bread");
    const response = await fetch(`${origin}/`, {
      method: "POST",
      body: form,
      headers: { origin },
      redirect: "manual",
    });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/done?title=Bread");
  }, 120_000);

  it("renders a POST that is not an action", async () => {
    const { origin } = await startServer(await createApp());
    const response = await fetch(`${origin}/done`, {
      method: "POST",
      body: new URLSearchParams({ note: "1" }),
      headers: { origin },
      redirect: "manual",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("done");
  }, 120_000);
});
