// @vitest-environment node

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let root: string | undefined;
let server: ChildProcess | undefined;
let serverExited: Promise<unknown> | undefined;
let port = 0;
// Stands in for a host the attacker controls. It is on loopback only so the test needs no network,
// which is why the app below allows local addresses.
let attacker: http.Server | undefined;
let attackerPort = 0;
const attackerHits: string[] = [];
const output: string[] = [];

/** A request with a Host header of the client's choosing, as any client can send. */
function request(pathname: string, host: string): Promise<{ status: number; type: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: pathname, headers: { host, accept: "image/webp" } },
      (res) => {
        res.resume();
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, type: String(res.headers["content-type"]) }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

const optimized = (source: string) =>
  `/_farm/image?${new URLSearchParams({ url: source, w: "16", q: "75" })}`;

beforeAll(async () => {
  attacker = http.createServer((req, res) => {
    attackerHits.push(`${req.headers.host}${req.url}`);
    res.setHeader("content-type", "image/png");
    res.end(Buffer.from(PNG, "base64"));
  });
  await new Promise<void>((resolve) => attacker!.listen(0, "127.0.0.1", resolve));
  attackerPort = (attacker.address() as AddressInfo).port;

  root = await fs.mkdtemp(path.join(packageRoot, ".tmp-image-host-header-"));
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
  await write("src/app/page.tsx", "export default function Page() { return <main>home</main>; }");
  await write(
    "src/app/api/chart/route.ts",
    `export function GET() {
  return new Response(Buffer.from(${JSON.stringify(PNG)}, "base64"), { headers: { "content-type": "image/png" } });
}`,
  );
  const config = await resolveConfig(
    {
      root,
      srcDir: "src",
      telemetry: false,
      images: {
        provider: "node",
        formats: ["image/webp"],
        remotePatterns: [{ hostname: "cdn.trusted.example" }],
        dangerouslyAllowLocalIP: true,
      },
      deploy: { target: "node-server" },
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
      await request("/", `127.0.0.1:${port}`);
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
  await new Promise((resolve) => attacker?.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("the image optimizer behind a Host header the client chose", () => {
  it("does not treat a source on the claimed host as local", async () => {
    const attackerHost = `localhost:${attackerPort}`;
    attackerHits.length = 0;

    // An absolute source on the claimed host is remote, and remotePatterns does not allow it.
    const absolute = await request(optimized(`http://${attackerHost}/x.png`), attackerHost);
    expect(absolute.status, output.join("")).toBe(400);

    // A relative source is read from this server, never from the claimed host.
    const relative = await request(optimized("/api/chart"), attackerHost);
    expect(relative.status, output.join("")).toBe(200);

    expect(attackerHits).toEqual([]);
  });

  it("still optimizes the app's own images behind a public Host", async () => {
    const response = await request(optimized("/api/chart"), "app.example.com");
    expect(response.status, output.join("")).toBe(200);
    expect(response.type).toBe("image/webp");
  });
});
