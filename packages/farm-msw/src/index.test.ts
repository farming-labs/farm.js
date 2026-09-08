import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { msw } from "./index.js";

const mocks = vi.hoisted(() => ({
  listen: vi.fn(),
  resetHandlers: vi.fn(),
  close: vi.fn(),
  setupServer: vi.fn(),
}));

vi.mock("msw/node", () => ({
  setupServer: mocks.setupServer,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.setupServer.mockReturnValue({
    listen: mocks.listen,
    resetHandlers: mocks.resetHandlers,
    close: mocks.close,
  });
});

function context(isDev: boolean) {
  return {
    config: {},
    isDev,
    isProd: !isDev,
    lifecycle: { onShutdown: vi.fn() },
    requestContext: {},
  } as never;
}

describe("msw Farm plugin", () => {
  it("adds a dev-only virtual handler module and serves the worker under basePath", async () => {
    const plugin = msw({ handlers: "src/mocks/handlers.ts" });
    const existing = { name: "existing" };
    const configured = await plugin.configure?.(
      {
        root: "/app",
        basePath: "/shop",
        plugins: [plugin],
        vite: { plugins: [existing] },
      } as never,
      context(true),
    );

    const publicConfig = plugin.client?.public as Record<string, unknown>;
    expect(publicConfig).toMatchObject({
      workerUrl: "/shop/mockServiceWorker.js",
      scope: "/shop/",
    });

    const vitePlugins = (configured as any).vite.plugins;
    expect(vitePlugins.map((entry: any) => entry.name)).toEqual(["farm:msw-vite", "existing"]);
    const vitePlugin = vitePlugins[0];
    expect(vitePlugin.resolveId("virtual:farm-msw-handlers")).toBe("\0virtual:farm-msw-handlers");
    expect(vitePlugin.load("\0virtual:farm-msw-handlers")).toContain(
      'import * as handlerModule from "/app/src/mocks/handlers.ts"',
    );

    let middleware: Function | undefined;
    vitePlugin.configureServer({
      middlewares: {
        use(value: Function) {
          middleware = value;
        },
      },
    });
    const response = {
      statusCode: 0,
      headers: new Map<string, string>(),
      body: "",
      setHeader(name: string, value: string) {
        this.headers.set(name, value);
      },
      end(body = "") {
        this.body = body;
      },
    };
    const next = vi.fn();
    middleware?.({ method: "GET", url: "/shop/mockServiceWorker.js?v=1" }, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.statusCode).toBe(200);
    expect(response.headers.get("Service-Worker-Allowed")).toBe("/shop/");
    expect(response.body).toContain("Mock Service Worker");
  });

  it("removes itself before production client and server bundles are generated", async () => {
    const plugin = msw({ handlers: "src/mocks/handlers.ts" });
    const other = { name: "other" };
    const configured = await plugin.configure?.(
      { plugins: [other, plugin], vite: {} } as never,
      context(false),
    );

    expect((configured as any).plugins).toEqual([other]);
    expect((configured as any).vite.plugins).toBeUndefined();
  });

  it("starts server mocking, refreshes handlers through HMR, and closes once", async () => {
    const plugin = msw({
      handlers: "src/mocks/handlers.ts",
      browser: false,
      onUnhandledRequest: "error",
    });
    await plugin.configure?.({ root: "/app", plugins: [plugin], vite: {} } as never, context(true));
    const state = await plugin.setup?.(context(true));
    const firstHandler = { id: "first" };
    const nextHandler = { id: "next" };
    const dependency = path.normalize("/app/src/mocks/data.ts");
    const handlerModule = {
      file: path.normalize("/app/src/mocks/handlers.ts"),
      importedModules: new Set([{ file: dependency }]),
    };
    const closeListeners: Array<() => void> = [];
    const viteServer = {
      ssrLoadModule: vi
        .fn()
        .mockResolvedValueOnce({ handlers: [firstHandler] })
        .mockResolvedValueOnce({ handlers: [nextHandler] }),
      moduleGraph: {
        getModulesByFile: vi.fn(() => new Set([handlerModule])),
      },
      httpServer: {
        once: vi.fn((_event: string, listener: () => void) => closeListeners.push(listener)),
        off: vi.fn(),
      },
    };

    await plugin.dev?.server?.(viteServer as never, { state } as never);
    expect(mocks.setupServer).toHaveBeenCalledWith(firstHandler);
    expect(mocks.listen).toHaveBeenCalledWith({ onUnhandledRequest: "error" });

    await plugin.dev?.update?.({ file: dependency, modules: [] }, { state } as never);
    expect(mocks.resetHandlers).toHaveBeenCalledWith(nextHandler);
    expect(viteServer.ssrLoadModule.mock.calls[1]?.[0]).toMatch(/\?farm-msw=\d+$/);

    await plugin.runtime?.close?.({ state } as never);
    closeListeners[0]?.();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("fails clearly when the handler module does not export an array", async () => {
    const plugin = msw({ handlers: "src/mocks/handlers.ts", browser: false });
    await plugin.configure?.({ root: "/app", plugins: [plugin], vite: {} } as never, context(true));
    const state = await plugin.setup?.(context(true));
    const viteServer = { ssrLoadModule: vi.fn(async () => ({ handlers: {} })) };

    await expect(plugin.dev?.server?.(viteServer as never, { state } as never)).rejects.toThrow(
      "must export a handlers array",
    );
  });
});
