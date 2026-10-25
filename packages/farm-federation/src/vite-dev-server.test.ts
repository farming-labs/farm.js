import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveFederationOptions } from "./config";
import { createFarmFederationVitePlugins } from "./vite";

// Upstream's SSR remote entry plugin mounted `/__mf_runner__` in development. It runs Vite's
// fetchModule for any id under the root and checks `server.fs.allow` but not `server.fs.deny`,
// so a text/plain POST (no CORS preflight) read `.env`. Farm federates browser modules only.
const SECRET = "FEDERATION_RUNNER_SECRET_VALUE";
let root: string;
let server: ViteDevServer;
let base: string;
let holdOptimizerWrite = false;
const optimizerStarted = Promise.withResolvers<void>();
const releaseOptimizer = Promise.withResolvers<void>();
const optimizerFinished = Promise.withResolvers<void>();
const closeEvents: string[] = [];

async function drainFixtureOptimizer() {
  // Match Farm's dev-lifecycle ordering: Vite 8 can cancel an optimizer without
  // awaiting its active Rolldown write. The scan can discover more dependencies.
  await Promise.all(
    Object.values(server?.environments ?? {}).map(async ({ depsOptimizer }) => {
      await depsOptimizer?.scanProcessing;
      await Promise.all(
        Object.values(depsOptimizer?.metadata.discovered ?? {}).map((dep) => dep.processing),
      );
    }),
  );
}

async function closeFixtureServer() {
  try {
    await drainFixtureOptimizer();
  } finally {
    await server?.close();
  }
}

beforeAll(async () => {
  // Upstream returns no plugins under a test runner unless told otherwise.
  vi.stubEnv("MFE_VITE_NO_TEST_ENV_CHECK", "true");
  root = await realpath(await mkdtemp(path.join(os.tmpdir(), "farm-federation-runner-")));
  await writeFile(path.join(root, "package.json"), '{"name":"host","type":"module"}');
  await writeFile(path.join(root, ".env"), `SECRET=${SECRET}\n`);
  await writeFile(
    path.join(root, "index.html"),
    '<html><body><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(path.join(root, "main.js"), "export {};\n");
  // Register this later, without racing a fixture file change against the watcher.
  await writeFile(path.join(root, "late-dependency.js"), "export const value = 1;\n");
  const options = resolveFederationOptions(
    { name: "host", types: false, remotes: { shop: "http://localhost:9/remoteEntry.js" } },
    { name: "react", dedupe: ["react"] },
  );
  server = await createServer({
    root,
    configFile: false,
    logLevel: "silent",
    plugins: createFarmFederationVitePlugins(options) as never,
    optimizeDeps: {
      rolldownOptions: {
        plugins: [
          {
            name: "hold-fixture-optimizer-write",
            async generateBundle(options) {
              if (!holdOptimizerWrite || !options.dir?.includes("deps_temp_")) return;
              optimizerStarted.resolve();
              await releaseOptimizer.promise;
            },
            writeBundle(options) {
              if (holdOptimizerWrite && options.dir?.includes("deps_temp_")) {
                closeEvents.push("written");
              }
            },
            closeBundle() {
              if (holdOptimizerWrite) optimizerFinished.resolve();
            },
          },
        ],
      },
    },
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Vite did not bind a port");
  base = `http://127.0.0.1:${address.port}`;
}, 60_000);

afterAll(async () => {
  releaseOptimizer.resolve();
  try {
    await closeFixtureServer();
  } finally {
    vi.unstubAllEnvs();
    // Keep the bounded Windows filesystem retries after optimizer work is drained.
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

describe("federation dev server", () => {
  it("does not mount the server-federation module runner", async () => {
    const response = await fetch(`${base}/__mf_runner__`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify({
        type: "custom",
        event: "vite:invoke",
        data: { id: "send:1", name: "fetchModule", data: [`${root}/.env?raw`] },
      }),
    });

    expect(await response.text()).not.toContain(SECRET);
    expect(response.status).toBe(404);
  });

  it("does not mount the server-federation remote entry", async () => {
    const response = await fetch(`${base}/__mf_ssr__/remoteEntry.ssr.js`);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("still serves the browser app", async () => {
    const response = await fetch(`${base}/main.js`);
    expect(response.status).toBe(200);
  });

  it("finishes an optimizer write before closing the fixture server", async () => {
    // Isolate the held write from initial discovery and the preceding requests.
    await drainFixtureOptimizer();
    const optimizer = server.environments.client.depsOptimizer!;
    const dependency = path.join(root, "late-dependency.js");
    holdOptimizerWrite = true;
    optimizer.registerMissingImport("fixture-late-dependency", dependency);
    optimizer.run();
    await optimizerStarted.promise;

    const closeServer = server.close.bind(server);
    server.close = async () => {
      closeEvents.push("server-close");
      await closeServer();
    };
    const closing = closeFixtureServer();
    releaseOptimizer.resolve();
    await closing;
    await optimizerFinished.promise;
    expect(closeEvents).toEqual(["written", "server-close"]);
  });
});
