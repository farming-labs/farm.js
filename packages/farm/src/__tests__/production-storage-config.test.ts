// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { loadConfig, resolveConfig } from "../config";

/**
 * `storage` in farm.config used to apply only on the development server: a
 * built app's getStorage() wrote to an in-memory root store whatever drivers
 * and mounts were configured, so data the app meant to persist vanished on
 * restart.
 */

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createFixture(): Promise<{ root: string; filesDir: string; notesDir: string }> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-storage-"));
  const filesDir = path.join(root, "data", "files");
  const notesDir = path.join(root, "data", "notes");

  await fs.mkdir(path.join(root, "node_modules", "@farm.js"), { recursive: true });
  // Junctions need no Windows privilege; the type is ignored on POSIX.
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farm.js", "core"), "junction");
  await fs.mkdir(path.join(root, "src", "app", "api", "note"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `
import { localStorage } from "@farm.js/core/storage";

export default {
  srcDir: "src",
  images: { provider: "none" },
  storage: {
    mounts: {
      files: localStorage({ base: ${JSON.stringify(filesDir)} }),
      notes: { driver: "fs-lite", base: ${JSON.stringify(notesDir)} },
    },
  },
};
`.trim(),
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `export default function Layout({ children }) { return <html><body>{children}</body></html>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `export default function HomePage() { return <main>home</main>; }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "api", "note", "route.ts"),
    `
import { getStorage } from "@farm.js/core/storage";

export async function POST() {
  await getStorage("files").setItem("greeting.txt", "hello from files");
  await getStorage("notes").setItem("greeting.txt", "hello from notes");
  return Response.json({ ok: true });
}
`.trim(),
  );

  return { root, filesDir, notesDir };
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

describe("production storage config", () => {
  it("writes through the configured mounts in a built app", async () => {
    const { root, filesDir, notesDir } = await createFixture();
    let production: Awaited<ReturnType<typeof startProductionServer>> | undefined;
    let outputDir: string | undefined;

    try {
      const userConfig = await loadConfig(root, undefined, "production");
      const config = await resolveConfig({ ...userConfig, root }, "production");
      await build(config, { root, preset: "node-server" });

      // Run the output from outside the repository, as a deployment does: no
      // node_modules above it can supply a module the bundle left external,
      // and the app itself does not depend on unstorage or db0.
      outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "farm-production-storage-output-"));
      await fs.cp(path.join(root, ".farm", ".output"), outputDir, { recursive: true });
      production = await startProductionServer(path.join(outputDir, "server"));
      const response = await fetch(`${production.origin}/api/note`, { method: "POST" });
      expect(response.status).toBe(200);

      expect(await fs.readFile(path.join(filesDir, "greeting.txt"), "utf8")).toBe(
        "hello from files",
      );
      expect(await fs.readFile(path.join(notesDir, "greeting.txt"), "utf8")).toBe(
        "hello from notes",
      );
    } finally {
      await production?.stop();
      await fs.rm(root, { recursive: true, force: true });
      if (outputDir) await fs.rm(outputDir, { recursive: true, force: true });
    }
  }, 180_000);
});
