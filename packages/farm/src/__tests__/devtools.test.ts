import { describe, expect, it, vi } from "vitest";
import { PluginManager } from "../plugin";
import { createFarmDevtoolsSnapshot } from "../devtools";
import { renderFarmDevtoolsHtml } from "../devtools-ui";

describe("farm devtools", () => {
  it("reports active plugin order and hook names without executing or exposing plugin data", async () => {
    const hook = vi.fn();
    const manager = new PluginManager({ config: {}, isDev: true, isProd: false });
    manager.addPlugins([
      { name: "last", enforce: "post", ready: hook },
      {
        name: "normal",
        version: "1.2.3",
        runtime: { before: hook },
        routes: () => ({}),
        client: {
          public: { secret: "not-for-the-inspector" },
          setup: hook,
          navigation: { rendered: hook },
        },
      },
      { name: "first", enforce: "pre", configure: hook, dev: { server: hook, update: hook } },
      {
        name: "normal-2",
        get setup() {
          throw new Error("must not invoke accessors");
        },
      },
    ]);
    const snapshot = await createFarmDevtoolsSnapshot({
      root: "/app",
      srcDir: "src",
      env: {},
      routeManager: {
        getRoutes: () => new Map(),
        getLayouts: () => new Map(),
        getLoadings: () => new Map(),
        getErrors: () => new Map(),
      },
      apiRouteManager: { getRoutes: () => new Map() },
      middlewareManager: { getMiddlewares: () => [] },
      config: { plugins: [{ name: "removed-during-configure" }] },
      plugins: manager.getSortedPlugins(),
    });
    expect(snapshot.counts.plugins).toBe(4);
    expect(snapshot.plugins).toEqual([
      {
        name: "first",
        order: 1,
        enforce: "pre",
        serverHooks: ["configure", "dev.server", "dev.update"],
        clientHooks: [],
        routes: false,
      },
      {
        name: "normal",
        version: "1.2.3",
        order: 2,
        enforce: "normal",
        serverHooks: ["runtime.before"],
        clientHooks: ["client.setup", "client.navigation.rendered"],
        routes: true,
      },
      {
        name: "normal-2",
        order: 3,
        enforce: "normal",
        serverHooks: [],
        clientHooks: [],
        routes: false,
      },
      {
        name: "last",
        order: 4,
        enforce: "post",
        serverHooks: ["ready"],
        clientHooks: [],
        routes: false,
      },
    ]);
    expect(hook).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).not.toContain("not-for-the-inspector");
    expect(JSON.stringify(snapshot)).not.toContain("removed-during-configure");
  });
  it("collects the effective application runtime", async () => {
    const snapshot = await createFarmDevtoolsSnapshot({
      root: "/repo/app",
      srcDir: "src",
      routeManager: {
        getRoutes: () =>
          new Map([
            [
              "/",
              {
                pattern: "/",
                modulePath: "/repo/app/src/app/page.tsx",
              },
            ],
          ]),
        getLayouts: () =>
          new Map([
            [
              "/",
              {
                pattern: "/",
                modulePath: "/repo/app/src/app/layout.tsx",
              },
            ],
          ]),
        getLoadings: () => new Map(),
        getErrors: () => new Map(),
        resolveRouteRuntimeConfig: () => ({
          runtime: "edge",
          regions: ["iad1"],
          maxDuration: 15,
        }),
      },
      apiRouteManager: {
        getRoutes: () =>
          new Map([
            [
              "/api/hello",
              {
                path: "/api/hello",
                methods: ["POST", "GET"],
                filePath: "/repo/app/src/app/api/hello/route.ts",
                runtime: "node",
              },
            ],
          ]),
      },
      middlewareManager: {
        getMiddlewares: () => [
          {
            path: "/dashboard",
            source: "file",
            filePath: "/repo/app/src/app/dashboard/middleware.ts",
            handlers: [() => undefined, () => undefined],
          },
        ],
      },
      config: {
        integrations: {
          stripe: {
            type: "stripe",
            category: "billing",
            routes: [{ path: "/api/stripe", method: "POST" }],
          },
          auth: {
            type: "better-auth",
            category: "auth",
            middleware: [() => undefined],
          },
        },
        docs: { enabled: true, entry: "/docs" },
        openapi: { enabled: true },
        experimental: {
          serverComponents: true,
          optimizedBoundary: true,
        },
        deploy: { target: "vercel", preset: "vercel" },
        storage: {
          driver: "memory",
          mounts: {
            assets: { driver: "fs" },
          },
        },
        cron: {
          cleanup: {
            schedule: "0 2 * * *",
            path: "/api/cleanup",
          },
        },
        env: {
          server: { DATABASE_URL: "postgres://secret" },
          public: { APP_URL: "https://farmjs.dev" },
        },
      } as any,
      workflows: [
        {
          id: "weekly-report",
          filePath: "/repo/app/src/workflows/weekly-report.ts",
          routePath: "/api/_farm/workflows/weekly-report",
          schedule: ["0 9 * * 1"],
        },
      ],
      now: () => new Date("2026-07-20T10:00:00.000Z"),
      env: {},
    });

    expect(snapshot.counts).toMatchObject({
      pages: 1,
      layouts: 1,
      apiRoutes: 1,
      middleware: 1,
      integrations: 2,
      storageMounts: 2,
      cronJobs: 1,
      workflows: 1,
    });
    expect(snapshot.routes).toContainEqual({
      kind: "page",
      pattern: "/",
      filePath: "src/app/page.tsx",
      runtime: {
        runtime: "edge",
        regions: ["iad1"],
        maxDuration: 15,
      },
    });
    expect(snapshot.apiRoutes[0]).toMatchObject({
      path: "/api/hello",
      methods: ["GET", "POST"],
      filePath: "src/app/api/hello/route.ts",
      runtime: { runtime: "node" },
    });
    expect(snapshot.middleware[0]).toMatchObject({
      path: "/dashboard",
      handlerCount: 2,
      filePath: "src/app/dashboard/middleware.ts",
    });
    expect(snapshot.integrations.map((integration) => integration.key)).toEqual(["auth", "stripe"]);
    expect(snapshot.storage).toEqual([
      { mount: "root", driver: "memory", default: false },
      { mount: "assets", driver: "fs", default: false },
    ]);
    expect(snapshot.deployment).toMatchObject({ target: "vercel", preset: "vercel" });
    expect(snapshot.environment).toEqual({
      server: ["DATABASE_URL"],
      public: ["APP_URL"],
    });
    expect(JSON.stringify(snapshot)).not.toContain("postgres://secret");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "CRON_ROUTE_MISSING",
      "CRON_SECRET_NOT_SET",
      "EPHEMERAL_PRODUCTION_STORAGE",
    ]);
    expect(snapshot.docs).toEqual({
      enabled: true,
      entry: "/docs",
    });
    expect(snapshot.features.openapi).toBe(true);
    expect(snapshot.features.optimizedBoundary).toBe(true);
  });

  it("renders the floating, navigable devtools inspector", async () => {
    const snapshot = await createFarmDevtoolsSnapshot({
      root: "/repo/app",
      srcDir: "src",
      routeManager: {
        getRoutes: () =>
          new Map([
            [
              "/about",
              {
                pattern: "/about",
                modulePath: "/repo/app/src/app/about/page.tsx",
              },
            ],
          ]),
        getLayouts: () => new Map(),
        getLoadings: () => new Map(),
        getErrors: () => new Map(),
      },
      apiRouteManager: {
        getRoutes: () => new Map(),
      },
      middlewareManager: {
        getMiddlewares: () => [],
      },
      config: { docs: false },
      now: () => new Date("2026-07-20T10:00:00.000Z"),
    });

    const html = renderFarmDevtoolsHtml(snapshot);

    expect(html).toContain("<title>Farm Devtools - app</title>");
    expect(html).toContain('data-inspector="overview"');
    expect(html).toContain('data-view-panel="overview"');
    expect(html).toContain('data-view-panel="runtime"');
    expect(html).toContain('data-view-panel="raw"');
    expect(html).toContain('data-detail-trigger="routes"');
    expect(html).toContain('<html lang="en" class="devtools-frame">');
    expect(html).not.toContain('class="app-preview"');
    expect(html).not.toContain('class="backdrop"');
    expect(html).toContain("width: min(960px, 92vw)");
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="Farm.js DevTools"');
    expect(html).toContain("data-close-devtools");
    expect(html).toContain("<code>/about</code>");
    expect(html).toContain("src/app/about/page.tsx");
    expect(html).toContain("No api routes found");

    expect(html).toContain("Deprecated &middot; use @farm.js/devtools");

    expect(html).toContain("const embedded = window.parent !== window");
    expect(html).toContain('type: "farm:devtools:close"');
  });
});
