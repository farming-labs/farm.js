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

// An app without a `src` directory keeps its folders at the project root,
// where Nitro would otherwise scan `middleware/` as server middleware and
// detect `server.ts` as its server entry.
async function createFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-root-src-dir-"));

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "app"), { recursive: true });
  await fs.mkdir(path.join(root, "lib"), { recursive: true });
  await fs.mkdir(path.join(root, "middleware"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
export default {
  srcDir: ".",
  images: { provider: "none" },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "lib", "label.ts"),
    `export const label = "root-src-dir-home";`,
  );
  await fs.writeFile(
    path.join(root, "middleware", "greeting.ts"),
    `import { label } from "@/lib/label";
export default function greeting() { return label; }`,
  );
  await fs.writeFile(
    path.join(root, "server.ts"),
    `import { label } from "@/lib/label";
export default { fetch: () => new Response("nitro-server-entry " + label) };`,
  );
  await fs.writeFile(
    path.join(root, "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "app", "page.tsx"),
    `import greeting from "@/middleware/greeting";
export default function HomePage() { return <main>{greeting()}</main>; }`,
  );

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

async function startProductionServer(serverDir: string): Promise<{
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
      await fetch(`${origin}/`);
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

describe("production build without a src directory", () => {
  it("does not bundle root app folders as Nitro handlers", async () => {
    const root = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;

    try {
      const config = await loadFixtureConfig(root);
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      await expect(fs.readFile(path.join(serverDir, "index.mjs"), "utf8")).resolves.not.toContain(
        "@/lib/label",
      );

      production = await startProductionServer(serverDir);

      const response = await fetch(`${production.origin}/`);
      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("<main>root-src-dir-home</main>");
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 180_000);
});
