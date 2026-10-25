// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

// React pages render with renderToString once a streaming render of the route
// finished without suspending. Output must match the streaming render, a
// suspending page must stream and render once, and a route that starts
// suspending later must still send its complete content.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function getAvailablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

const files: Record<string, string> = {
  "package.json": JSON.stringify({
    private: true,
    type: "module",
    dependencies: { "@farm.js/core": "workspace:*" },
  }),
  "src/app/globals.css": "",
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }`,
  "src/app/page.tsx": `
import { useId } from "react";
export const dynamic = "force-dynamic";
function Field() { const id = useId(); return <label htmlFor={id}>name {id}</label>; }
export default function Page() {
  return (
    <main>
      <title>sync page</title>
      <p>café ☕ {1} {"<b>"}</p>
      <Field />
      <ul>{Array.from({ length: 20 }, (_, i) => <li key={i}>item {i}</li>)}</ul>
    </main>
  );
}
`,
  "src/app/stream/page.tsx": `
import { Suspense } from "react";
export const dynamic = "force-dynamic";
// A thrown promise suspends on React 18 and 19; a fresh one per request.
function createResource() {
  const resource = { done: false, promise: undefined };
  resource.promise = new Promise((resolve) =>
    setTimeout(() => {
      resource.done = true;
      resolve();
    }, 20),
  );
  return resource;
}
function Late({ resource }) {
  if (!resource.done) throw resource.promise;
  return <p>late content</p>;
}
export default function Page() {
  globalThis.__farmStreamRenders = (globalThis.__farmStreamRenders ?? 0) + 1;
  return <main><Suspense fallback={<p>loading</p>}><Late resource={createResource()} /></Suspense></main>;
}
`,
  "src/app/flip/page.tsx": `
import { Suspense } from "react";
export const dynamic = "force-dynamic";
// A thrown promise suspends on React 18 and 19; a fresh one per request.
function createResource() {
  const resource = { done: false, promise: undefined };
  resource.promise = new Promise((resolve) =>
    setTimeout(() => {
      resource.done = true;
      resolve();
    }, 20),
  );
  return resource;
}
function Late({ resource }) {
  if (!resource.done) throw resource.promise;
  return <p>late content</p>;
}
export default function Page() {
  if (!globalThis.__farmFlipSuspends) return <main><p>sync content</p></main>;
  return <main><Suspense fallback={<p>loading</p>}><Late resource={createResource()} /></Suspense></main>;
}
`,
  "src/app/api/flip/route.ts": `
export async function GET(request) {
  globalThis.__farmFlipSuspends = new URL(request.url).searchParams.get("on") === "1";
  return Response.json({ ok: true });
}
`,
  "src/app/api/state/route.ts": `
export async function GET() {
  return Response.json({ streamRenders: globalThis.__farmStreamRenders ?? 0 });
}
`,
};

// React 19's streaming renderer adds a doctype before an <html> root and React
// 18's does not; both must send the same document on every request.
const reactVersions = [
  { label: "React 19", modules: path.join(packageRoot, "node_modules") },
  {
    label: "React 18",
    modules: path.resolve(packageRoot, "../../examples/simple-demo/node_modules"),
  },
];

describe.each(reactVersions)("React sync rendering ($label)", ({ modules }) => {
  let root = "";
  let base = "";
  let server: ReturnType<typeof spawn> | undefined;
  const output: string[] = [];

  const page = async (pathname: string) => {
    const response = await fetch(`${base}${pathname}`, {
      headers: { "accept-encoding": "identity" },
    });
    expect(response.status).toBe(200);
    return response.text();
  };

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-sync-render-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const name of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(modules, name)),
        path.join(root, "node_modules", name),
        "junction",
      );
    }
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source.trim());
    }

    const config = await resolveConfig(
      {
        root,
        srcDir: "src",
        images: { provider: "none" },
        generateBuildId: () => "sync-render-test",
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });

    const serverDirectory = path.join(root, ".farm", ".output", "server");
    const port = await getAvailablePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
      cwd: serverDirectory,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        await fetch(`${base}/api/state`);
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    throw new Error(`Production server did not start\n${output.join("")}`);
  }, 180_000);

  afterAll(async () => {
    // Windows keeps the server directory locked until the process has exited.
    if (server && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server?.once("exit", resolve));
      server.kill();
      await exited;
    }
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it("sends the same document on the first (streamed) and later (sync) requests", async () => {
    const first = await page("/");
    expect(first.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(first.match(/<!DOCTYPE html>/gi)).toHaveLength(1);
    expect(first).toContain("café ☕");
    expect(first).toContain("&lt;b&gt;");
    expect(first).toContain("<title>sync page</title>");
    for (let request = 0; request < 3; request++) {
      expect(await page("/")).toBe(first);
    }
  });

  it("streams a page that suspends and renders it once per request", async () => {
    const before = (await (await fetch(`${base}/api/state`)).json()).streamRenders;
    for (let request = 0; request < 3; request++) {
      const html = await page("/stream");
      expect(html).toContain("late content");
    }
    const after = (await (await fetch(`${base}/api/state`)).json()).streamRenders;
    expect(after - before).toBe(3);
  });

  it("still sends complete content when a route starts suspending later", async () => {
    await fetch(`${base}/api/flip?on=0`);
    expect(await page("/flip")).toContain("sync content");
    expect(await page("/flip")).toContain("sync content");

    await fetch(`${base}/api/flip?on=1`);
    for (let request = 0; request < 2; request++) {
      const html = await page("/flip");
      expect(html).toContain("late content");
      expect(html).not.toContain("<!--$!-->");
    }

    await fetch(`${base}/api/flip?on=0`);
    expect(await page("/flip")).toContain("sync content");
  });
});
