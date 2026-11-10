// @vitest-environment node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { getAvailablePort } from "./dev-server-port";
import {
  literalRouteExposure,
  literalRouteFiles,
  verifyLiteralRouteExposure,
} from "./markdown-route-contract";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const labels = Array.from({ length: 1_000 }, (_, index) => `Item ${index}`);
const expected = `${labels.join(" ")}\n\nabc\n\nexample\n`;

describe("production Markdown layout rows", () => {
  let root = "";
  let origin = "";
  let server: ReturnType<typeof spawn> | undefined;
  const output: string[] = [];

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-md-rows-"));
    await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
    await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
    for (const pkg of ["react", "react-dom"]) {
      await fs.symlink(
        await fs.realpath(path.join(packageRoot, "node_modules", pkg)),
        path.join(root, "node_modules", pkg),
        "junction",
      );
    }
    const files = {
      "package.json": '{"private":true,"type":"module"}',
      "src/app/globals.css": "",
      "src/app/layout.tsx":
        "export default function Layout({ children }) { return <>{children}</>; }",
      "src/app/page.tsx": `export default function Page() {
  return <main>
    <div>{Array.from({ length: 1000 }, (_, index) => <span key={index}>Item {index}</span>)}</div>
    <div><span>a</span><span>b</span><span>c</span></div>
    <div>ex<span>am</span><span>ple</span></div>
  </main>;
}`,
      ...literalRouteFiles,
    };
    for (const [file, source] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), source);
    }
    const config = await resolveConfig(
      {
        root,
        md: { includeMetadata: false, expose: literalRouteExposure },
        images: { provider: "none" },
        generateBuildId: () => "markdown-rows-test",
      },
      "production",
    );
    await build(config, { root, preset: "node-server" });
    const serverDirectory = path.join(root, ".farm", ".output", "server");
    const port = await getAvailablePort();
    origin = `http://127.0.0.1:${port}`;
    server = spawn(process.execPath, [path.join(serverDirectory, "index.mjs")], {
      cwd: serverDirectory,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let launchError: Error | undefined;
    server.on("error", (error) => {
      launchError = error;
    });
    server.stdout?.on("data", (chunk) => output.push(String(chunk)));
    server.stderr?.on("data", (chunk) => output.push(String(chunk)));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      if (server.exitCode !== null || server.signalCode !== null) break;
      try {
        const response = await fetch(origin);
        const body = await response.text();
        if (response.ok && body.includes("Item")) return;
      } catch {
        // The process has not bound its socket yet; readiness is a real response.
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error(`Production server did not become ready\n${output.join("")}`);
  }, 180_000);

  afterAll(async () => {
    if (server?.pid && server.exitCode === null && server.signalCode === null) {
      const exited = new Promise((resolve) => server!.once("exit", resolve));
      server.kill();
      await exited;
    }
    if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it.each(["/index.md", "/"])(
    "keeps row text, fallbacks, and validators at %s",
    async (pathname) => {
      const url = `${origin}${pathname}`;
      const response = await fetch(url, { headers: { accept: "text/markdown" } });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
      expect(await response.text()).toBe(expected);
      const etag = response.headers.get("etag");
      expect(etag).toBeTruthy();
      const head = await fetch(url, { method: "HEAD", headers: { accept: "text/markdown" } });
      expect(head.status).toBe(200);
      expect(head.headers.get("etag")).toBe(etag);
      expect(await head.text()).toBe("");
      for (const method of ["GET", "HEAD"]) {
        const cached = await fetch(url, {
          method,
          headers: { accept: "text/markdown", "if-none-match": etag! },
        });
        expect(cached.status).toBe(304);
        expect(await cached.text()).toBe("");
      }
    },
  );

  it("keeps literal exposure and dynamic fallbacks after a production build", async () => {
    await verifyLiteralRouteExposure(origin);
  });
});
