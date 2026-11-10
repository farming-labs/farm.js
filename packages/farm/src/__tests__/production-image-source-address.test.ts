// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// An IP allowlist that trusts the server's own loopback address, as an
// internal-only route often does.
const FILES: Record<string, string> = {
  "farm.config.ts": `export default {
  telemetry: false,
  images: { provider: "node", formats: ["image/webp"] },
  middleware: [
    {
      matcher: ["/api/internal/:path*"],
      handler(ctx) {
        const address = String(ctx.request.socket?.remoteAddress ?? "");
        if (address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1") return;
        return new Response("internal only", { status: 403 });
      },
    },
  ],
};`,
  "src/app/layout.tsx": `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  "src/app/page.tsx": `export default function Page() { return <main>home</main>; }`,
  "src/app/api/internal/chart/route.ts": `export function GET() {
  return new Response(Buffer.from(${JSON.stringify(PNG)}, "base64"), { headers: { "content-type": "image/png" } });
}`,
};

let root: string | undefined;
let server: ChildProcess | undefined;
let base = "";
const output: string[] = [];

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-image-source-address-"));
  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module","private":true}');
  for (const [relativePath, source] of Object.entries(FILES)) {
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
    await fs.writeFile(path.join(root, relativePath), source);
  }
  const config = await resolveConfig(
    { ...(await loadConfig(root, undefined, "production")), root, srcDir: "src" },
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
      await fetch(`${base}/`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Production server did not start\n${output.join("")}`);
}, 180_000);

afterAll(async () => {
  if (server && server.exitCode === null && server.signalCode === null) {
    const exited = new Promise((resolve) => server?.once("exit", resolve));
    server.kill();
    await exited;
  }
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("the image optimizer's local source fetch", () => {
  it("is not admitted by a guard that trusts loopback addresses", async () => {
    // The test itself connects from loopback, so the guard admits it directly.
    expect((await fetch(`${base}/api/internal/chart`)).status).toBe(200);

    // Through the optimizer the source is fetched for any visitor, and the
    // result is cached for all of them, so the guard must not see 127.0.0.1.
    const optimized = await fetch(`${base}/_farm/image?url=/api/internal/chart&w=16&q=75`, {
      headers: { accept: "image/webp" },
    });
    await optimized.arrayBuffer();
    expect(optimized.status, output.join("")).toBe(502);
  });
});
