// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

let root: string | undefined;
let server: ChildProcess | undefined;
let serverExited: Promise<unknown> | undefined;
let port = 0;
const output: string[] = [];

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** A raw request, so the test sees the bytes and encoding the server sent. */
function request(pathname: string, headers: Record<string, string> = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("latin1"),
        }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

const renderedAt = (body: string) =>
  body
    .match(/data-at="([^"]+)"|"at":([\d.]+)/)
    ?.slice(1)
    .find(Boolean);

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-cache-route-rules-"));
  const write = async (relativePath: string, source: string) => {
    await fs.mkdir(path.dirname(path.join(root!, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root!, relativePath), source);
  };
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await write("package.json", '{"type":"module","private":true}');
  await write(
    "src/app/layout.tsx",
    "export default function Layout({ children }) { return <html><body>{children}</body></html>; }",
  );
  await write(
    "src/app/news/page.tsx",
    `export const revalidate = 60;
export default function News() { return <main data-at={String(Date.now() + Math.random())}>news</main>; }`,
  );
  const api = `export function GET() {
  return Response.json({ at: Date.now() + Math.random(), pad: "x".repeat(4000) });
}`;
  await write("src/app/api/feed/route.ts", api);
  await write("src/app/api/live/route.ts", api);
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      telemetry: false,
      images: { provider: "none" },
      deploy: { target: "node-server" },
      routeRules: { "/news": { swr: 60 }, "/api/feed": { swr: 60 } },
    },
    "production",
  );
  await build(config, { root, preset: "node-server" });

  const serverDirectory = path.join(root, ".farm", ".output", "server");
  port = await getAvailablePort();
  server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
    cwd: serverDirectory,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverExited = new Promise((resolve) => server!.once("exit", resolve));
  server.stdout?.on("data", (chunk) => output.push(String(chunk)));
  server.stderr?.on("data", (chunk) => output.push(String(chunk)));
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      await request("/api/live");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Production server did not start\n${output.join("")}`);
}, 180_000);

afterAll(async () => {
  // Windows refuses to remove the output while the server still holds it as its cwd.
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill();
    await serverExited;
  }
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("swr route rules on a Node server", () => {
  it("stores a shareable page and serves the stored render", async () => {
    const browser = { accept: "text/html", "accept-encoding": "gzip, br" };
    const first = await request("/news", browser);
    const second = await request("/news", browser);
    expect(first.status, output.join("")).toBe(200);
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(renderedAt(second.body)).toBe(renderedAt(first.body));
    // The stored body is sent as it is: never compressed bytes without a Content-Encoding.
    expect(second.headers["content-encoding"]).toBeUndefined();
    expect(second.body).toContain("news");
  });

  it("keys the stored page on Accept, so a Markdown request gets Markdown", async () => {
    await request("/news", { accept: "text/html" });
    const markdown = await request("/news", { accept: "text/markdown" });
    expect(markdown.headers["content-type"]).toContain("text/markdown");
  });

  it("stores an API response, with compression left to the cache layer", async () => {
    const first = await request("/api/feed", { "accept-encoding": "gzip" });
    const second = await request("/api/feed", { "accept-encoding": "gzip" });
    expect(second.headers["x-cache"]).toBe("HIT");
    expect(renderedAt(second.body)).toBe(renderedAt(first.body));
    expect(second.headers["content-encoding"]).toBeUndefined();
    expect(JSON.parse(second.body).pad).toHaveLength(4000);
  });

  it("still compresses a route no cache rule covers", async () => {
    const live = await request("/api/live", { "accept-encoding": "gzip" });
    expect(live.headers["content-encoding"]).toBe("gzip");
    expect(live.headers["x-cache"]).toBeUndefined();
  });
});
