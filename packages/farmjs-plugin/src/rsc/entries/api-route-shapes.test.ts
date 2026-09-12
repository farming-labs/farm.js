import { describe, expect, it } from "vitest";
import { matchAPIRoute, registerAPIRouteShape } from "@farm.js/core/api/runtime";
import { generateRscEntry } from "./rsc.js";

function createRegistry() {
  const entry = generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    routesDir: "app",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 500_000 },
    deploymentId: "route-shapes",
    debug: false,
  });
  const start = entry.indexOf("const apiRouteMethods =");
  const end = entry.indexOf("\n\nregisterApiRouteSources(apiRouteModules", start);
  return new Function(
    "registerAPIRouteShape",
    `${entry.slice(start, end)};
    return { apiRouteMap, registerApiEndpoint, registerApiRouteSources };`,
  )(registerAPIRouteShape);
}

describe("generated RSC API route shapes", () => {
  it.each(["/api/users/[slug]", "/api/users/[id]/"])(
    "rejects ambiguous path %s within one source",
    (path) => {
      const { registerApiEndpoint } = createRegistry();
      registerApiEndpoint("/api/users/[id]", "first.ts", "GET", () => {}, 0);
      expect(() => registerApiEndpoint(path, "second.ts", "POST", () => {}, 0)).toThrow(
        /Ambiguous API routes.*first.ts.*second.ts/,
      );
    },
  );

  it.each([
    ["/api/teams/[id]/users/[id]", /Duplicate route parameter/],
    ["/api/users/[__proto__]", /reserved/],
    ["/api/users/[...__proto__]", /reserved/],
    ["/api/users/[[...constructor]]", /reserved/],
    ["/api/docs/[...slug]/edit", /final segment/],
  ])("rejects invalid parameter definitions in %s", (path, message) => {
    const { registerApiEndpoint, apiRouteMap } = createRegistry();
    expect(() => registerApiEndpoint(path, "invalid.ts", "GET", () => {}, 0)).toThrow(message);
    expect(apiRouteMap.size).toBe(0);
  });

  it("replaces a layer's entire dynamic shape with the project route", () => {
    const { registerApiEndpoint, apiRouteMap } = createRegistry();
    const project = () => new Response("project");
    registerApiEndpoint("/api/users/[id]", "layer.ts", "GET", () => {}, 0);
    registerApiEndpoint("/api/users/[id]", "layer.ts", "POST", () => {}, 0);
    registerApiEndpoint("/api/users/[slug]", "project.ts", "GET", project, 1);
    const match = matchAPIRoute(apiRouteMap, "/api/users/alice") as any;
    expect(match.route.path).toBe("/api/users/[slug]");
    expect(match.route.handlers.GET).toBe(project);
    expect(match.route.methods).toEqual(["GET"]);
    expect(match.params).toEqual({ slug: "alice" });
    expect(apiRouteMap.has("/api/users/[id]")).toBe(false);
  });

  it("applies shape checks across file, explicit endpoint, and programmatic definitions", () => {
    for (const programmatic of [false, true]) {
      const { registerApiRouteSources } = createRegistry();
      const endpoint = Object.assign(() => {}, { __path: "/api/users/[slug]", __method: "GET" });
      const module = programmatic
        ? {
            routes: {
              __farmRoutes: true,
              routes: [{ kind: "api", path: "/api/users/[slug]", methods: { GET: () => {} } }],
            },
          }
        : { endpoint };
      expect(() =>
        registerApiRouteSources(
          [
            {
              sourceIndex: 0,
              relativePath: "/api/users/[id]/route.ts",
              filePath: "file.ts",
              module: { GET: () => {} },
            },
          ],
          [{ sourceIndex: 0, filePath: "definitions.ts", module }],
          1,
        ),
      ).toThrow(/Ambiguous API routes/);
    }
  });

  it("keeps static, dynamic, required and optional catch-all routes distinct", () => {
    const { registerApiEndpoint, apiRouteMap } = createRegistry();
    for (const path of [
      "/api/users/[[...rest]]",
      "/api/users/[...rest]",
      "/api/users/[id]",
      "/api/users/new",
      "/api/users",
    ]) {
      registerApiEndpoint(path, path + "/route.ts", "GET", () => {}, 0);
    }
    expect(matchAPIRoute(apiRouteMap, "/api/users")?.route.path).toBe("/api/users");
    expect(matchAPIRoute(apiRouteMap, "/api/users/new")?.route.path).toBe("/api/users/new");
    expect(matchAPIRoute(apiRouteMap, "/api/users/alice")?.route.path).toBe("/api/users/[id]");
    expect(matchAPIRoute(apiRouteMap, "/api/users/alice/posts")?.route.path).toBe(
      "/api/users/[...rest]",
    );
  });
});
