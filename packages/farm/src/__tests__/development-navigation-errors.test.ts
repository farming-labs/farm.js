// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

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

async function writeModule(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

const navigation = 'import { notFound, redirect } from "@farm.js/core/navigation";';
const wait = "await new Promise((resolve) => setTimeout(resolve, 20));";

async function startProject(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-navigation-"));
  temporaryRoots.add(root);
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await fs.symlink(
    await fs.realpath(packageRoot),
    path.join(root, "node_modules", "@farm.js", "core"),
    "junction",
  );
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');

  await writeModule(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <div id="layout">{children}</div>; }`,
  );
  // A root loading boundary streams every page behind Suspense.
  await writeModule(
    root,
    "src/app/loading.tsx",
    `import React from "react";
export default function Loading() { return <p>loading</p>; }`,
  );
  await writeModule(
    root,
    "src/app/not-found.tsx",
    `import React from "react";
export default function NotFound({ pathname }) { return <main>custom not found: {pathname}</main>; }`,
  );
  await writeModule(
    root,
    "src/app/page.tsx",
    `import React from "react";
export default function Page() { return <main>home</main>; }`,
  );
  await writeModule(
    root,
    "src/app/sync-missing/page.tsx",
    `${navigation}
export default function Page() { notFound(); }`,
  );
  await writeModule(
    root,
    "src/app/sync-redirect/page.tsx",
    `${navigation}
export default function Page() { redirect("/"); }`,
  );
  await writeModule(
    root,
    "src/app/async-missing/page.tsx",
    `${navigation}
export default async function Page() { ${wait} notFound(); }`,
  );
  // A nested async component behind its own boundary finishes after the shell.
  for (const [name, call] of [
    ["late-missing", "notFound()"],
    ["late-redirect", 'redirect("/")'],
    ["late-script-redirect", 'redirect("java\\tscript:alert(1)")'],
  ]) {
    await writeModule(
      root,
      `src/app/${name}/page.tsx`,
      `import React, { Suspense } from "react";
${navigation}
async function Late() { ${wait} ${call}; }
export default function Page() { return <Suspense fallback={<p>loading</p>}><Late /></Suspense>; }`,
    );
  }
  for (const [name, call] of [
    ["middleware-missing", "notFound()"],
    ["middleware-redirect", 'redirect("/")'],
  ]) {
    await writeModule(
      root,
      `src/app/${name}/middleware.ts`,
      `${navigation}
export function middleware() { ${call}; }`,
    );
    await writeModule(
      root,
      `src/app/${name}/page.tsx`,
      `import React from "react";
export default function Page() { return <main>should not render</main>; }`,
    );
  }

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  await server.listen(await getAvailablePort());
  const address = server.httpServer?.address();
  if (!address || typeof address === "string") throw new Error("Missing dev server address");
  return `http://localhost:${address.port}`;
}

describe("development redirect() and notFound()", () => {
  it("answers them with real statuses before the shell, and recovers after it", async () => {
    const origin = await startProject();
    const get = (pathname: string) => fetch(`${origin}${pathname}`, { redirect: "manual" });

    // Thrown while React renders the shell: the response is not committed yet.
    const syncMissing = await get("/sync-missing");
    expect(syncMissing.status).toBe(404);
    expect(await syncMissing.text()).toMatch(/custom not found: (<!-- -->)?\/sync-missing/);

    const syncRedirect = await get("/sync-redirect");
    expect(syncRedirect.status).toBe(307);
    expect(syncRedirect.headers.get("location")).toBe("/");

    // From middleware: the same answers, instead of a 500.
    const middlewareMissing = await get("/middleware-missing");
    expect(middlewareMissing.status).toBe(404);
    const middlewareMissingBody = await middlewareMissing.text();
    expect(middlewareMissingBody).toContain("custom not found");
    expect(middlewareMissingBody).not.toContain("should not render");

    const middlewareRedirect = await get("/middleware-redirect");
    expect(middlewareRedirect.status).toBe(307);
    expect(middlewareRedirect.headers.get("location")).toBe("/");

    // An async page streams behind the loading boundary in development, so its
    // notFound() lands after the shell too.
    const asyncMissing = await get("/async-missing");
    expect(asyncMissing.status).toBe(200);
    expect(await asyncMissing.text()).toContain('<template id="__farm_late_not_found__">');

    // After the 200 shell went out: the document recovers in the browser.
    const lateMissing = await get("/late-missing");
    expect(lateMissing.status).toBe(200);
    const lateMissingBody = await lateMissing.text();
    expect(lateMissingBody).toMatch(
      /<template id="__farm_late_not_found__"><main>custom not found: (<!-- -->)?\/late-missing<\/main><\/template>/,
    );
    expect(lateMissingBody).toContain('m.content="noindex"');
    expect(lateMissingBody).toContain('dataset.farmLateNotFound="true"');

    const lateRedirect = await get("/late-redirect");
    expect(lateRedirect.status).toBe(200);
    expect(await lateRedirect.text()).toContain('window.location.replace("/")');

    // A late redirect never becomes script: only http(s) targets recover.
    const lateScriptRedirect = await get("/late-script-redirect");
    expect(lateScriptRedirect.status).toBe(200);
    expect(await lateScriptRedirect.text()).not.toContain("window.location.replace");
  }, 60_000);
});
