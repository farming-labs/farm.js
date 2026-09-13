import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pwa } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

class RegistrationMock extends EventTarget {
  waiting: { postMessage: ReturnType<typeof vi.fn> } | null = { postMessage: vi.fn() };
  installing: ServiceWorker | null = null;
}

class ServiceWorkerContainerMock extends EventTarget {
  controller = {} as ServiceWorker;
  registration = new RegistrationMock();
  register = vi.fn(async () => this.registration as unknown as ServiceWorkerRegistration);
}

class CustomEventMock<T = unknown> extends Event {
  readonly detail: T;

  constructor(type: string, init?: CustomEventInit<T>) {
    super(type);
    this.detail = init?.detail as T;
  }
}

describe("pwa browser lifecycle", () => {
  it("registers only in production and exposes a prompt update action", async () => {
    const serviceWorker = new ServiceWorkerContainerMock();
    const browserWindow = new EventTarget() as EventTarget & {
      location: { reload: ReturnType<typeof vi.fn> };
      __FARM_PWA__?: unknown;
    };
    browserWindow.location = { reload: vi.fn() };
    vi.stubGlobal("navigator", { serviceWorker });
    vi.stubGlobal("window", browserWindow);
    vi.stubGlobal("CustomEvent", CustomEventMock);

    const updateEvents: CustomEvent[] = [];
    browserWindow.addEventListener("farm:pwa:update-available", (event) => {
      updateEvents.push(event as CustomEvent);
    });

    const plugin = pwa({ offline: "/offline", cache: { images: "swr" } });
    const publicConfig = plugin.client?.public;
    const state = await plugin.client?.setup?.({
      plugin: { name: plugin.name },
      public: publicConfig,
      router: {} as never,
      isDev: false,
      isProd: true,
    } as never);

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", { scope: "/" });
    expect(updateEvents).toHaveLength(1);

    const detail = updateEvents[0]!.detail as { applyUpdate(): void };
    detail.applyUpdate();
    expect(serviceWorker.registration.waiting?.postMessage).toHaveBeenCalledWith({
      type: "FARM_PWA_SKIP_WAITING",
    });

    serviceWorker.dispatchEvent(new Event("controllerchange"));
    expect(browserWindow.location.reload).toHaveBeenCalledTimes(1);

    await plugin.client?.close?.({ state } as never);
    expect(browserWindow.__FARM_PWA__).toBeUndefined();
  });

  it("does not register a service worker during development", async () => {
    const serviceWorker = new ServiceWorkerContainerMock();
    vi.stubGlobal("navigator", { serviceWorker });
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { reload: vi.fn() } }));

    const plugin = pwa();
    await plugin.client?.setup?.({
      plugin: { name: plugin.name },
      public: plugin.client.public,
      router: {} as never,
      isDev: true,
      isProd: false,
    } as never);

    expect(serviceWorker.register).not.toHaveBeenCalled();
  });

  it("registers a custom module worker through the same browser lifecycle", async () => {
    const serviceWorker = new ServiceWorkerContainerMock();
    serviceWorker.controller = null as never;
    serviceWorker.registration.waiting = null;
    vi.stubGlobal("navigator", { serviceWorker });
    vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { reload: vi.fn() } }));

    const plugin = pwa({
      serviceWorker: { source: "src/service-worker.js", type: "module" },
    });
    await plugin.client?.setup?.({
      plugin: { name: plugin.name },
      public: plugin.client.public,
      router: {} as never,
      isDev: false,
      isProd: true,
    } as never);

    expect(serviceWorker.register).toHaveBeenCalledWith("/sw.js", {
      scope: "/",
      type: "module",
    });
  });
});

describe("pwa production build lifecycle", () => {
  it.each([undefined, { enabled: false }, { enabled: true }])(
    "uses the configured HTML output prefix without guessing from folder names: %j",
    async (i18n) => {
      const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-plugin-base-"));
      const publicDir = path.join(root, "public");
      const localized = i18n?.enabled === true;
      const homeFile = localized ? "app/en/index.html" : "index.html";
      const appFile = localized ? "app/en/app/index.html" : "app/index.html";
      const route = localized ? "/en/app" : "/app";
      const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
      try {
        for (const file of [homeFile, appFile]) {
          await mkdir(path.dirname(path.join(publicDir, file)), { recursive: true });
          await writeFile(path.join(publicDir, file), file);
        }
        const plugin = pwa({ offline: route, cache: "auto" });
        await plugin.configure?.({ root, basePath: "/app", i18n } as never, {} as never);
        const configured = await plugin.build?.configure?.(
          { preset: "node-server", output: { dir: root, publicDir } },
          {} as never,
        );
        await configured.hooks["prerender:done"]({ prerenderedRoutes: [] });
        const worker = await readFile(path.join(publicDir, "app", "sw.js"), "utf8");
        const homeRoute = localized ? "/app/en" : "/app";
        const homeUrl = localized ? "/app/en/index.html" : "/app/index.html";
        expect(worker).toContain(`${JSON.stringify(homeRoute)}:${JSON.stringify(homeUrl)}`);
        expect(worker).toContain(`"/app${route}":"/app${route}/index.html"`);
        expect(worker).toContain(`const OFFLINE_FILE = "/app${route}/index.html"`);
        expect(plugin.client.public).toMatchObject({ workerUrl: "/app/sw.js", scope: "/app/" });
      } finally {
        info.mockRestore();
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("generates the worker after prerendering and before Nitro compiles public assets", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "farm-pwa-plugin-"));
    const outputDir = path.join(root, ".farm", ".output");
    const publicDir = path.join(outputDir, "public");
    await mkdir(path.join(publicDir, "offline"), { recursive: true });
    await writeFile(path.join(publicDir, "index.html"), "home");
    await writeFile(path.join(publicDir, "offline", "index.html"), "offline");
    await writeFile(path.join(publicDir, "app.js"), "export default 1");

    const previousPrerenderDone = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    try {
      const plugin = pwa({ offline: "/offline" });
      await plugin.configure?.({ root } as never, {} as never);
      const configured = await plugin.build?.configure?.(
        {
          preset: "node-server",
          output: { dir: outputDir, publicDir },
          hooks: { "prerender:done": previousPrerenderDone },
        },
        {} as never,
      );

      await configured.hooks["rollup:before"]({ options: { preset: "nitro-prerender" } });
      await expect(access(path.join(publicDir, "sw.js"))).rejects.toThrow();

      await configured.hooks["prerender:done"]({ prerenderedRoutes: [] });
      expect(previousPrerenderDone).toHaveBeenCalledOnce();
      expect(await readFile(path.join(publicDir, "sw.js"), "utf8")).toContain(
        'const OFFLINE_FILE = "/offline/index.html"',
      );
    } finally {
      info.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });
});
