// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-public-dir-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "dir");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.mkdir(path.join(root, "static", "nested"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: "src",
  images: { provider: "none" },
  publicDir: "static",
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>custom-public-dir-home</main>; }`,
  );
  await fs.writeFile(path.join(root, "static", "hello.txt"), "hello-from-custom-public-dir");
  await fs.writeFile(path.join(root, "static", "nested", "data.json"), '{"ok":true}');

  return root;
}

async function loadFixtureConfig(root: string) {
  const userConfig = await loadConfig(root, undefined, "production");
  return resolveConfig({ ...userConfig, root }, "production");
}

async function getAvailablePort(): Promise<number> {
  const server = createNetServer();
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

async function startProductionServer(
  serverDir: string,
  readinessPath = "/",
): Promise<{
  origin: string;
  stop: () => Promise<void>;
}> {
  const port = await getAvailablePort();
  const output: string[] = [];
  const child = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  const origin = `http://127.0.0.1:${port}`;

  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`Production server exited before readiness:\n${output.join("")}`);
    }
    try {
      await fetch(`${origin}${readinessPath}`);
      return {
        origin,
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGTERM");
          await new Promise<void>((resolve) => {
            const timeout = setTimeout(() => {
              child.kill("SIGKILL");
              resolve();
            }, 2_000);
            child.once("exit", () => {
              clearTimeout(timeout);
              resolve();
            });
          });
        },
      };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  child.kill("SIGKILL");
  throw new Error(
    `Production server did not become ready: ${String(lastError)}\n${output.join("")}`,
  );
}

describe("production build with a custom publicDir", () => {
  it("emits configured publicDir assets into the client output and serves them", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      expect(config.publicDir).toBe("static");
      await build(config, { root, preset: "node-server" });

      const publicOutputDir = path.join(root, ".farm", ".output", "public");
      await expect(fs.readFile(path.join(publicOutputDir, "hello.txt"), "utf8")).resolves.toBe(
        "hello-from-custom-public-dir",
      );
      await expect(
        fs.readFile(path.join(publicOutputDir, "nested", "data.json"), "utf8"),
      ).resolves.toBe('{"ok":true}');

      production = await startProductionServer(path.join(root, ".farm", ".output", "server"));

      const assetResponse = await fetch(`${production.origin}/hello.txt`);
      expect(assetResponse.status).toBe(200);
      await expect(assetResponse.text()).resolves.toBe("hello-from-custom-public-dir");

      const nestedResponse = await fetch(`${production.origin}/nested/data.json`);
      expect(nestedResponse.status).toBe(200);
      await expect(nestedResponse.json()).resolves.toEqual({ ok: true });
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
