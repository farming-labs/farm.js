// @vitest-environment node

import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig, type ViteDevServer } from "vite";
import { getFarmDevFsDeny, VITE_DEFAULT_FS_DENY } from "../dev-preview-guard";
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

async function writeFile(root: string, relativePath: string, source: string): Promise<void> {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, source);
}

async function startApp(): Promise<{ port: number; root: string }> {
  const root = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "farm-development-preview-guard-")),
  );
  temporaryRoots.add(root);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const pkg of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
      path.join(root, "node_modules", pkg),
      "junction",
    );
  }
  await writeFile(root, "package.json", '{"private":true,"type":"module"}');
  await writeFile(root, "farm.config.ts", 'export const FALLBACK_KEY = "sk_config_secret";\n');
  await writeFile(root, "secrets.json", '{"token":"sk_root_secret"}');
  await writeFile(root, ".farm/auth.sqlite", "session-rows");
  await writeFile(root, "public/hello.txt", "public hello");
  await writeFile(
    root,
    "src/app/layout.tsx",
    `import React from "react";
export default function Layout({ children }) { return <>{children}</>; }`,
  );
  await writeFile(
    root,
    "src/app/page.tsx",
    `import React from "react";
import notes from "./notes.txt?raw";
export default function Page() { return <main>home {notes}</main>; }`,
  );
  await writeFile(root, "src/app/notes.txt", "client notes");
  await writeFile(root, "src/app/logo.svg", "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(root, "src/app/data.sqlite", "local rows");
  await writeFile(root, "src/server/db.server.ts", 'export const DB_PASSWORD = "hunter2";\n');
  await writeFile(
    root,
    "src/app/api/echo/route.ts",
    `export async function POST(request: Request) { return new Response(await request.text()); }`,
  );

  const server = await createServer({ root, images: { provider: "none" } });
  servers.add(server);
  const port = await getAvailablePort();
  await server.listen(port);
  return { port, root };
}

/** node:http keeps the path exactly as written, unlike fetch, which normalizes `%2e%2e`. */
function send(
  port: number,
  rawPath: string,
  options: { preview?: boolean; method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        host: "localhost",
        port,
        method: options.method || "GET",
        path: rawPath,
        headers: options.preview ? { "x-farm-preview": "1" } : {},
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => resolve({ status: response.statusCode || 0, body }));
      },
    );
    request.on("error", reject);
    request.end(options.body);
  });
}

describe("development server file exposure", () => {
  it("never serves Farm's build output and local state, even to the developer", async () => {
    const { port } = await startApp();

    const database = await send(port, "/.farm/auth.sqlite");
    expect(database.status).toBe(403);
    expect(database.body).not.toContain("session-rows");
    // Ordinary local development is otherwise unchanged.
    expect((await send(port, "/farm.config.ts")).status).toBe(200);
  }, 60_000);

  it("keeps developer-only files and tools off a farm preview URL", async () => {
    const { port, root } = await startApp();
    const fsRoot = path.posix.join("/@fs", root.replace(/\\/g, "/"));
    const preview = (rawPath: string) => send(port, rawPath, { preview: true });

    for (const rawPath of [
      "/.farm/auth.sqlite",
      "/farm.config.ts",
      "/farm.config",
      "/src/%2e%2e/farm.config.ts",
      "/@id/farm.config.ts",
      "/secrets.json",
      "/package.json",
      "/src/server/db.server.ts?raw",
      "/src/server/db.server.ts?import&raw",
      "/src/server/db.server.ts?inline",
      "/src/server/db.server.ts?url",
      "/@id/src/server/db.server.ts?raw",
      "/src/app/data.sqlite",
      `${fsRoot}/secrets.json`,
      `${fsRoot}/farm.config.ts`,
      `${fsRoot}/src/app/page.tsx?raw`,
      "/__farm/devtools.json",
      "/__farm/devtools",
      "/__open-in-editor?file=farm.config.ts",
    ]) {
      const response = await preview(rawPath);
      expect({ rawPath, status: response.status }).toEqual({ rawPath, status: 403 });
      expect(response.body).not.toMatch(/sk_config_secret|sk_root_secret|hunter2|session-rows/);
    }
    // A federation module runner, when one is mounted, evaluates any id under the root on POST.
    const runner = await send(port, "/__mf_runner__", {
      preview: true,
      method: "POST",
      body: "{}",
    });
    expect(runner.status).toBe(403);
  }, 60_000);

  it("still serves what the preview's browser needs", async () => {
    const { port, root } = await startApp();
    const fsRoot = path.posix.join("/@fs", root.replace(/\\/g, "/"));
    const preview = (rawPath: string) => send(port, rawPath, { preview: true });

    const page = await preview("/");
    expect(page.status).toBe(200);
    expect(page.body).toContain("home");
    expect((await preview("/@vite/client")).status).toBe(200);
    // The fixture has no @farm.js/core install for the client entry to import; it only must not
    // be refused.
    expect((await preview("/@farm/client.js")).status).not.toBe(403);
    expect((await preview("/hello.txt")).body).toBe("public hello");
    expect((await preview("/src/app/logo.svg")).status).toBe(200);
    expect((await preview(`${fsRoot}/node_modules/react/index.js`)).status).toBe(200);
    expect(
      (await send(port, "/api/echo", { preview: true, method: "POST", body: "hi" })).body,
    ).toBe("hi");

    // The page module is app code the client router loads by URL; loading it registers its own
    // imports, so the `?raw` import the app ships is served while other raw source is not.
    expect((await preview("/src/app/page.tsx")).status).toBe(200);
    const notes = await preview("/src/app/notes.txt?import&raw");
    expect(notes.status).toBe(200);
    expect(notes.body).toContain("client notes");
    expect((await preview("/src/app/page.tsx?raw")).status).toBe(403);
  }, 60_000);
});

describe("development fs.deny", () => {
  it("restates Vite's own defaults when the app has not configured the list", async () => {
    const resolved = await resolveConfig({ configFile: false, logLevel: "silent" }, "serve");
    expect([...VITE_DEFAULT_FS_DENY]).toEqual(resolved.server.fs.deny);

    expect(getFarmDevFsDeny(undefined, { root: "/app" })).toEqual([
      ...VITE_DEFAULT_FS_DENY,
      "**/.farm/**",
    ]);
    // Vite appends a plugin's list to the app's own, so only Farm's entries are returned then.
    expect(getFarmDevFsDeny(["secret/**"], { root: "/app", distDir: "dist" })).toEqual([
      "**/.farm/**",
      `${path.resolve("/app", "dist").replace(/\\/g, "/")}/**`,
    ]);
    expect(getFarmDevFsDeny(["secret/**"], { root: "/app", distDir: "." })).toEqual([
      "**/.farm/**",
    ]);
  });
});
