// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";

// The node-server handler passes srvx's Request on unchanged. Its signal must
// abort on a real disconnect only, like Farm's own signal on other adapters.

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
  "src/app/layout.tsx": `export default function Layout({ children }) { return <div>{children}</div>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>signal page</main>; }`,
  "src/app/api/watch/[id]/route.ts": `
const state = (globalThis.__farmSignals ??= {});
export async function GET(request) {
  const entry = (state[new URL(request.url).pathname.split("/").pop()] = { aborted: request.signal.aborted });
  request.signal.addEventListener("abort", () => { entry.aborted = true; });
  return Response.json({ ok: true });
}
`,
  "src/app/api/upload/[id]/route.ts": `
const state = (globalThis.__farmSignals ??= {});
export async function POST(request) {
  const entry = (state[new URL(request.url).pathname.split("/").pop()] = { aborted: false });
  request.signal.addEventListener("abort", () => { entry.aborted = true; });
  const text = await request.text();
  entry.received = text.length;
  return Response.json({
    received: text.length,
    method: request.method,
    contentType: request.headers.get("content-type"),
    url: new URL(request.url).pathname + new URL(request.url).search,
  });
}
`,
  "src/app/api/hang/[id]/route.ts": `
const state = (globalThis.__farmSignals ??= {});
export async function GET(request) {
  const entry = (state[new URL(request.url).pathname.split("/").pop()] = { aborted: false });
  await new Promise((resolve) => {
    request.signal.addEventListener("abort", () => { entry.aborted = true; resolve(); });
    setTimeout(resolve, 10_000);
  });
  return new Response("late");
}
`,
  "src/app/api/state/route.ts": `
export async function GET() {
  return Response.json(globalThis.__farmSignals ?? {});
}
`,
};

describe("production request signal on node-server", () => {
  let root = "";
  let base = "";
  let server: ReturnType<typeof spawn> | undefined;
  const output: string[] = [];

  const state = async () =>
    (await (await fetch(`${base}/api/state`)).json()) as Record<
      string,
      { aborted: boolean; received?: number }
    >;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-request-signal-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const name of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", name)),
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
        generateBuildId: () => "request-signal-test",
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

  it("does not abort a request that finished normally", async () => {
    expect((await fetch(`${base}/api/watch/get`)).status).toBe(200);
    // Give a wrongly wired close listener the chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await state()).get).toEqual({ aborted: false });
  });

  it("keeps the method, headers, body and URL of an upload, and does not abort it", async () => {
    const body = "x".repeat(200_000);
    const response = await fetch(`${base}/api/upload/post?mode=full`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body,
    });
    expect(await response.json()).toEqual({
      received: body.length,
      method: "POST",
      contentType: "text/plain",
      url: "/api/upload/post?mode=full",
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await state()).post).toEqual({ aborted: false, received: body.length });
  });

  it("aborts when the client disconnects before the response", async () => {
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${base}/api/hang/gone`);
      req.on("error", () => resolve());
      req.end();
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 300);
    });
    let entry: { aborted: boolean } | undefined;
    for (let attempt = 0; attempt < 50 && !entry?.aborted; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      entry = (await state()).gone;
    }
    expect(entry).toEqual({ aborted: true });
  });

  it("never hands an abandoned upload to the route as complete", async () => {
    await new Promise<void>((resolve) => {
      const req = httpRequest(`${base}/api/upload/half`, {
        method: "POST",
        headers: { "content-type": "text/plain", "content-length": "100000" },
      });
      req.on("error", () => resolve());
      req.write("x".repeat(1000));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 300);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    // Farm rejects the aborted body read (#952); the route never sees a body.
    expect((await state()).half?.received).toBeUndefined();
    expect((await fetch(`${base}/api/watch/after`)).status).toBe(200);
  });
});
