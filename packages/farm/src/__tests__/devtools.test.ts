import { describe, expect, it } from "vitest";
import { createFarmDevtoolsSnapshot } from "../devtools";
import { renderFarmDevtoolsHtml } from "../devtools-ui";

describe("farm devtools", () => {
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
  });

  it("renders the sharp, navigable devtools inspector", async () => {
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
    expect(html).toContain("/__farm/devtools.json");
    expect(html).toContain('data-inspector="overview"');
    expect(html).toContain('data-view-panel="overview"');
    expect(html).toContain('data-view-panel="runtime"');
    expect(html).toContain('data-view-panel="raw"');
    expect(html).toContain('data-detail-trigger="routes"');
    expect(html).toContain("border-radius: 0 !important");
    expect(html).toContain("<code>/about</code>");
    expect(html).toContain("src/app/about/page.tsx");
    expect(html).toContain("No api routes found");
  });
});
