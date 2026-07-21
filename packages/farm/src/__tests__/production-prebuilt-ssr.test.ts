// @vitest-environment node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { build } from "../build";
import { resolveConfig } from "../config";
import { definePlugin } from "../plugin";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function createProductionFixture(): Promise<string> {
  const root = await fs.mkdtemp(path.join(packageRoot, ".tmp-production-prebuilt-ssr-"));

  await fs.mkdir(path.join(root, "node_modules", "@farmjs"), { recursive: true });
  await fs.symlink(packageRoot, path.join(root, "node_modules", "@farmjs", "core"), "dir");
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ private: true, type: "module" }, null, 2),
  );
  await fs.writeFile(path.join(root, "src", "app", "globals.css"), "");
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    `
export default function RootLayout({ children }) {
  return <html><body>{children}</body></html>;
}
`.trim(),
  );
  await fs.writeFile(path.join(root, "src", "app", "prebuilt-ssr-marker.txt"), "copied SSR asset");
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    `
import markerAsset from "./prebuilt-ssr-marker.txt?url";

export default function Page() {
  return <main data-prebuilt-ssr="ready" data-marker-asset={markerAsset}>prebuilt SSR output</main>;
}
`.trim(),
  );

  return root;
}

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

async function waitForServer(url: string, processOutput: () => string, hasExited: () => boolean) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (hasExited()) {
      throw new Error(`Production server exited before it was ready:\n${processOutput()}`);
    }
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(
    `Production server did not become ready: ${String(lastError)}\n${processOutput()}`,
  );
}

async function runProductionRequest(
  serverDir: string,
  assertion: (response: Response) => Promise<void>,
): Promise<void> {
  const port = await getAvailablePort();
  const output: string[] = [];
  let spawnError: Error | undefined;
  const productionServer = spawn(process.execPath, [path.join(serverDir, "index.mjs")], {
    cwd: serverDir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  productionServer.stdout.on("data", (chunk) => output.push(String(chunk)));
  productionServer.stderr.on("data", (chunk) => output.push(String(chunk)));
  productionServer.on("error", (error) => {
    spawnError = error;
  });

  try {
    const response = await waitForServer(
      `http://127.0.0.1:${port}/`,
      () => (spawnError ? `${spawnError.message}\n${output.join("")}` : output.join("")),
      () => spawnError !== undefined || productionServer.exitCode !== null,
    );
    await assertion(response);
  } finally {
    if (productionServer.exitCode === null) {
      productionServer.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          productionServer.kill("SIGKILL");
          resolve();
        }, 2_000);
        productionServer.once("exit", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }
}

async function readJavaScriptOutput(dir: string): Promise<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const contents = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return readJavaScriptOutput(entryPath);
      return entry.name.endsWith(".mjs") ? fs.readFile(entryPath, "utf8") : "";
    }),
  );
  return contents.join("\n");
}

async function containsFileWithContent(dir: string, expected: string): Promise<boolean> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (await containsFileWithContent(entryPath, expected)) return true;
    } else if ((await fs.readFile(entryPath, "utf8")) === expected) {
      return true;
    }
  }
  return false;
}

async function expectNitroFallback(root: string): Promise<void> {
  const serverDir = path.join(root, ".farm", ".output", "server");
  const serverPackage = JSON.parse(await fs.readFile(path.join(serverDir, "package.json"), "utf8"));
  expect(serverPackage.imports?.["#farm-ssr-entry"]).toBeUndefined();
  await expect(fs.access(path.join(serverDir, "farm-ssr"))).rejects.toThrow();
  await expect(fs.readFile(path.join(serverDir, "index.mjs"), "utf8")).resolves.not.toContain(
    "#farm-ssr-entry",
  );
}

describe("production prebuilt SSR output", () => {
  it("boots standalone Node output through the package import mapping", async () => {
    const root = await createProductionFixture();

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      await expect(
        containsFileWithContent(path.join(serverDir, "farm-ssr"), "copied SSR asset"),
      ).resolves.toBe(true);
      await expect(readJavaScriptOutput(serverDir)).resolves.toContain("mergeVaryHeaders");

      await fs.rm(path.join(root, ".farm", "ssr"), { recursive: true, force: true });
      await runProductionRequest(serverDir, async (response) => {
        expect(response.status).toBe(200);
        await expect(response.text()).resolves.toContain("prebuilt SSR output");
      });
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("preserves an explicit minify false build hook", async () => {
    const root = await createProductionFixture();
    let configureCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "unminified-prebuilt-ssr-test",
              build: {
                configure(nitroConfig) {
                  configureCalls++;
                  return { ...nitroConfig, minify: false };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      const serverDir = path.join(root, ".farm", ".output", "server");
      const serverPackage = JSON.parse(
        await fs.readFile(path.join(serverDir, "package.json"), "utf8"),
      );
      const mappedEntry = serverPackage.imports?.["#farm-ssr-entry"];
      expect(configureCalls).toBe(1);
      expect(mappedEntry).toMatch(/^\.\/farm-ssr\//);
      const copiedEntry = path.join(serverDir, mappedEntry);
      const sourceEntry = path.join(root, ".farm", "ssr", mappedEntry.slice("./farm-ssr/".length));
      await expect(fs.readFile(copiedEntry, "utf8")).resolves.toBe(
        await fs.readFile(sourceEntry, "utf8"),
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a build plugin customizes Rollup", async () => {
    const root = await createProductionFixture();
    let configureCalls = 0;
    let rollupBuildStarts = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "custom-rollup-fallback-test",
              build: {
                configure(nitroConfig) {
                  configureCalls++;
                  return {
                    ...nitroConfig,
                    rollupConfig: {
                      ...nitroConfig.rollupConfig,
                      plugins: [
                        {
                          name: "custom-rollup-fallback-test",
                          buildStart() {
                            rollupBuildStarts++;
                          },
                        },
                      ],
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(configureCalls).toBe(1);
      expect(rollupBuildStarts).toBeGreaterThan(0);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a build plugin replaces externalization", async () => {
    const root = await createProductionFixture();
    let externalCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "custom-external-fallback-test",
              build: {
                configure(nitroConfig) {
                  const defaultExternal = nitroConfig.rollupConfig.external;
                  if (typeof defaultExternal !== "function") {
                    throw new TypeError("Expected Nitro's default external predicate");
                  }
                  return {
                    ...nitroConfig,
                    rollupConfig: {
                      ...nitroConfig.rollupConfig,
                      external(id: string, importer: string | undefined, isResolved: boolean) {
                        externalCalls++;
                        return defaultExternal(id, importer, isResolved);
                      },
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(externalCalls).toBeGreaterThan(0);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("retains Nitro's bundle path when a late Nitro build hook is configured", async () => {
    const root = await createProductionFixture();
    let rollupHookCalls = 0;

    try {
      const config = await resolveConfig(
        {
          root,
          srcDir: "src",
          images: { provider: "none" },
          generateBuildId: () => "prebuilt-ssr-test",
          plugins: [
            definePlugin({
              name: "late-nitro-hook-fallback-test",
              build: {
                configure(nitroConfig) {
                  return {
                    ...nitroConfig,
                    hooks: {
                      ...nitroConfig.hooks,
                      "rollup:before"(_nitro: unknown, rollupConfig: { plugins: unknown[] }) {
                        rollupHookCalls++;
                        rollupConfig.plugins.push({ name: "late-rollup-hook-test" });
                      },
                    },
                  };
                },
              },
            }),
          ],
        },
        "production",
      );
      await build(config, { root, preset: "node-server" });

      expect(rollupHookCalls).toBe(1);
      await expectNitroFallback(root);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  }, 120_000);
});
