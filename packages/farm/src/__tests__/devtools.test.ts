import { describe, expect, it } from "vitest";
import { createFarmDevtoolsSnapshot, renderFarmDevtoolsHtml } from "../devtools";

describe("farm devtools", () => {
  it("collects routes, api routes, middleware, integrations, and docs status", () => {
    const snapshot = createFarmDevtoolsSnapshot({
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
      integrations: {
        stripe: {},
        auth: {},
      },
      docs: {
        enabled: true,
        entry: "/docs",
      },
    });

    expect(snapshot.counts).toMatchObject({
      pages: 1,
      layouts: 1,
      apiRoutes: 1,
      middleware: 1,
      integrations: 2,
    });
    expect(snapshot.routes).toContainEqual({
      kind: "page",
      pattern: "/",
      filePath: "src/app/page.tsx",
    });
    expect(snapshot.apiRoutes[0]).toMatchObject({
      path: "/api/hello",
      methods: ["GET", "POST"],
      filePath: "src/app/api/hello/route.ts",
    });
    expect(snapshot.middleware[0]).toMatchObject({
      path: "/dashboard",
      handlerCount: 2,
      filePath: "src/app/dashboard/middleware.ts",
    });
    expect(snapshot.integrations).toEqual(["auth", "stripe"]);
    expect(snapshot.docs).toEqual({
      enabled: true,
      entry: "/docs",
    });
  });

  it("renders the devtools dashboard shell", () => {
    const snapshot = createFarmDevtoolsSnapshot({
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
      integrations: {},
      docs: {
        enabled: false,
      },
    });

    const html = renderFarmDevtoolsHtml(snapshot);

    expect(html).toContain("<title>Farm Devtools</title>");
    expect(html).toContain("Project Runtime");
    expect(html).toContain("/__farm/devtools.json");
    expect(html).toContain("<code>/about</code>");
    expect(html).toContain("src/app/about/page.tsx");
    expect(html).toContain("No API routes discovered yet.");
  });
});
