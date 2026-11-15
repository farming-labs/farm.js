// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ViteDevServer } from "vite";
import { createServer, startDevServer } from "../server/create-server";
import { getAvailablePort } from "./dev-server-port";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projects: Array<{ root: string; server?: ViteDevServer }> = [];

afterEach(async () => {
  for (const { root, server } of projects.splice(0)) {
    await server?.close().catch(() => {});
    Reflect.deleteProperty(globalThis, Symbol.for(root));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

type ResourceState = {
  setup: number;
  start: number;
  dispose: number;
  register: number;
  shutdown: number;
  disposeGate?: Promise<void>;
  onDispose?: () => void;
  onShutdown?: () => void;
  onViteClose?: () => void;
  failDispose?: boolean;
  restartGate?: Promise<void>;
  onRestart?: () => void;
  failRestart?: boolean;
};

async function createProject(middlewareMode = false) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "farm-dev-restart-")));
  const project: { root: string; server?: ViteDevServer } = { root };
  projects.push(project);
  const state: ResourceState = { setup: 0, start: 0, dispose: 0, register: 0, shutdown: 0 };
  Reflect.set(globalThis, Symbol.for(root), state);

  await fs.mkdir(path.join(root, "node_modules"), { recursive: true });
  for (const name of ["react", "react-dom"]) {
    await fs.symlink(
      await fs.realpath(path.join(packageRoot, "node_modules", name)),
      path.join(root, "node_modules", name),
      "junction",
    );
  }
  await fs.writeFile(path.join(root, "package.json"), '{"private":true,"type":"module"}');
  await fs.writeFile(
    path.join(root, "farm.config.ts"),
    `const state = globalThis[Symbol.for(${JSON.stringify(root)})];
export default {
  images: { provider: "none" },
  plugins: [{
    name: "restart-resource",
    setup(context) {
      state.setup++;
      context.lifecycle.onShutdown(async () => {
        state.onDispose?.();
        await state.disposeGate;
        state.dispose++;
        if (state.failDispose) throw new Error("resource disposal failed");
      });
    },
    runtime: { start() { state.start++; } },
    beforeRequest(req, res) {
      if (req.url !== "/resource") return;
      res.statusCode = state.dispose || state.shutdown ? 503 : 200;
      res.end(state.dispose || state.shutdown ? "resource closed" : "resource open");
    },
  }],
  vite: {
    server: { middlewareMode: ${middlewareMode} },
    plugins: [{
      name: "restart-control",
      async config() {
        if (state.restartGate) {
          state.onRestart?.();
          await state.restartGate;
        }
        if (state.failRestart) throw new Error("restart config failed");
      },
      configureServer(server) {
        const close = server.close.bind(server);
        server.close = async () => {
          await close();
          state.onViteClose?.();
        };
      },
    }],
  },
};`,
  );
  await fs.mkdir(path.join(root, "src", "app"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "instrumentation.ts"),
    `const state = globalThis[Symbol.for(${JSON.stringify(root)})];
export function register() { state.register++; }
export function shutdown() { state.shutdown++; state.onShutdown?.(); }`,
  );
  await fs.writeFile(
    path.join(root, "src", "app", "layout.tsx"),
    "export default function Layout({ children }) { return <>{children}</>; }",
  );
  await fs.writeFile(
    path.join(root, "src", "app", "page.tsx"),
    "export default function Page() { return <main>restart</main>; }",
  );
  const server = middlewareMode
    ? await createServer({ root })
    : await startDevServer({ root }, await getAvailablePort());
  project.server = server;
  const address = server.httpServer?.address();
  const resource = async () => {
    if (!address || typeof address === "string") throw new Error("Missing server address");
    const response = await fetch(`http://localhost:${address.port}/resource`);
    return { status: response.status, body: await response.text() };
  };
  return { server, state, resource };
}

describe("development server restart lifecycle", () => {
  it("keeps plugin resources and instrumentation alive across repeated and forced restarts", async () => {
    const { server, state, resource } = await createProject();
    expect(await resource()).toEqual({ status: 200, body: "resource open" });

    for (const force of [false, true, false]) {
      const previousWatcher = server.watcher;
      await server.restart(force);
      expect(await resource()).toEqual({ status: 200, body: "resource open" });
      expect(state).toEqual({ setup: 1, start: 1, dispose: 0, register: 1, shutdown: 0 });
      expect(server.watcher).not.toBe(previousWatcher);
    }

    await Promise.all([server.close(), server.close()]);
    expect(state).toEqual({ setup: 1, start: 1, dispose: 1, register: 1, shutdown: 1 });
    expect(server.httpServer?.listening).toBe(false);
    expect(server.watcher.closed).toBe(true);
  }, 60_000);

  it("awaits asynchronous disposal after restart and reports its failure", async () => {
    const { server, state } = await createProject();
    await server.restart();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    state.onDispose = entered.resolve;
    state.disposeGate = release.promise;
    state.failDispose = true;
    let settled = false;
    const closing = server.close();
    const result = closing.then(
      () => {
        settled = true;
      },
      (error) => {
        settled = true;
        return error;
      },
    );
    try {
      await entered.promise;
      expect(settled).toBe(false);
      expect(state.shutdown).toBe(0);
    } finally {
      release.resolve();
    }
    expect(await result).toBeInstanceOf(Error);
    await expect(closing).rejects.toThrow(/resource disposal failed|shutdown failed/i);
    await expect(server.close()).rejects.toThrow(/resource disposal failed|shutdown failed/i);
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
    expect(server.watcher.closed).toBe(true);
  }, 60_000);

  it("releases resources when the replacement HTTP listener is closed directly", async () => {
    const { server, state } = await createProject();
    await server.restart();
    let viteCloses = 0;
    state.onViteClose = () => {
      viteCloses++;
    };
    const finished = Promise.withResolvers<void>();
    state.onShutdown = finished.resolve;
    await new Promise<void>((resolve, reject) => {
      server.httpServer!.close((error) => (error ? reject(error) : resolve()));
    });
    await finished.promise;
    expect(viteCloses).toBe(1);
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
    await server.close();
    expect(state.dispose).toBe(1);
    expect(server.watcher.closed).toBe(true);
  }, 60_000);

  it("closes the adopted generation when shutdown overlaps coalesced restarts", async () => {
    const { server, state } = await createProject();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    state.onRestart = entered.resolve;
    state.restartGate = release.promise;
    const restarting = server.restart();
    let closing: Promise<void> | undefined;
    let forced: Promise<void> | undefined;
    try {
      await entered.promise;
      forced = server.restart(true);
      closing = server.close();
      await expect(server.restart()).rejects.toThrow(/during or after shutdown/);
      expect(state.dispose).toBe(0);
      expect(state.shutdown).toBe(0);
    } finally {
      release.resolve();
      await Promise.all([restarting, forced, closing]);
    }
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
    expect(server.httpServer?.listening).toBe(false);
    expect(server.watcher.closed).toBe(true);
    await expect(server.restart()).rejects.toThrow(/during or after shutdown/);
  }, 60_000);

  it("keeps the current runtime usable when Vite rejects replacement configuration", async () => {
    const { server, state, resource } = await createProject();
    const previousWatcher = server.watcher;
    state.failRestart = true;
    // Vite logs configuration failures and resolves restart(), retaining the
    // current server. Farm must not interpret that attempt as final shutdown.
    await server.restart();
    expect(server.watcher).toBe(previousWatcher);
    expect(await resource()).toEqual({ status: 200, body: "resource open" });
    expect(state.dispose).toBe(0);
    expect(state.shutdown).toBe(0);
    state.failRestart = false;
    await server.restart();
    expect(server.watcher).not.toBe(previousWatcher);
    expect(await resource()).toEqual({ status: 200, body: "resource open" });
    await server.close();
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
  }, 60_000);

  it("preserves lifecycle ownership without an HTTP server in middleware mode", async () => {
    const { server, state } = await createProject(true);
    expect(server.httpServer).toBeNull();
    await server.restart();
    expect(state.dispose).toBe(0);
    expect(state.shutdown).toBe(0);
    await server.close();
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
    expect(server.watcher.closed).toBe(true);
  }, 60_000);

  it("cleans up a directly closed listener when a concurrent restart fails", async () => {
    const { server, state } = await createProject();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    state.onRestart = entered.resolve;
    state.restartGate = release.promise;
    state.failRestart = true;
    state.onShutdown = finished.resolve;
    const restarting = server.restart();
    try {
      await entered.promise;
      await new Promise<void>((resolve, reject) => {
        server.httpServer!.close((error) => (error ? reject(error) : resolve()));
      });
      expect(state.dispose).toBe(0);
    } finally {
      release.resolve();
      await restarting;
    }
    await finished.promise;
    expect(state.dispose).toBe(1);
    expect(state.shutdown).toBe(1);
    await server.close();
    expect(server.watcher.closed).toBe(true);
  }, 60_000);
});
