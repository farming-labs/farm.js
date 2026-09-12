// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { createRouteFactory, type PluginAPIRouter } from "../api/route";
import { definePlugin } from "../plugin";
import { defineConfig } from "../config-entry";
import { APIRouteManager } from "../api/route-manager";
import { createAPIClient } from "../api/client";
import { mergePluginAPIRoutes } from "../api/plugin-route-runtime";
import { invokeAPIRouteEndpoint, matchAPIRoute } from "../api/runtime";

const uploads = definePlugin({
  name: "test:uploads",
  routes: ({ route }) => {
    const project = route.scope("/api/projects/[projectId]");
    return [
      project.get("uploads/[uploadId]", {
        input: {
          params: z.object({ projectId: z.string().min(1), uploadId: z.string().min(1) }),
          query: z.object({ format: z.enum(["short", "full"]).default("short") }),
        },
        handler(_request, { input }) {
          expectTypeOf(input.params.projectId).toEqualTypeOf<string>();
          expectTypeOf(input.query.format).toEqualTypeOf<"short" | "full">();
          return {
            id: input.params.uploadId,
            projectId: input.params.projectId,
            format: input.query.format,
          };
        },
      }),
      project.post("uploads", {
        input: {
          body: z.object({ name: z.string().trim().min(1) }),
          headers: z.object({ "x-test-token": z.string() }),
        },
        handler(_request, { input }) {
          return { name: input.body.name };
        },
      }),
    ];
  },
});
const config = defineConfig({ plugins: [uploads] });
type Router = PluginAPIRouter<typeof config>;
const routes = mergePluginAPIRoutes([], [uploads]);
const manifest = routes.map(({ path, methods }) => ({ path, methods }));

afterEach(() => vi.unstubAllGlobals());

describe("plugin API routes", () => {
  it("composes immutable scopes and mounts them through dev discovery", async () => {
    const manager = new APIRouteManager("/nonexistent-farm-plugin-test-app", undefined, {
      plugins: [uploads],
    });
    await manager.discoverRoutes();
    const response = await manager.getHandler()!(
      new Request("http://farm.test/api/projects/p1/uploads/u1"),
    );
    expect(await response.json()).toEqual({ id: "u1", projectId: "p1", format: "short" });
    await manager.discoverRoutes();
    expect(manager.getRoutes().size).toBe(2);
  });

  it("uses the same endpoints in the production registration table", async () => {
    const table = new Map(routes.map((route) => [route.path, route]));
    const match = matchAPIRoute(table, "/api/projects/p2/uploads/u2")!;
    const response = await invokeAPIRouteEndpoint(
      match.route.endpoints.GET,
      new Request("http://farm.test/api/projects/p2/uploads/u2?format=full"),
      match.params,
    );
    expect(await response.json()).toEqual({ id: "u2", projectId: "p2", format: "full" });
  });

  it("generates typed, reusable nested callers without requests during binding", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const request = new Request(url, init);
      const match = matchAPIRoute(
        new Map(routes.map((route) => [route.path, route])),
        new URL(url).pathname,
      )!;
      return invokeAPIRouteEndpoint(match.route.endpoints[request.method], request, match.params);
    });
    vi.stubGlobal("fetch", fetch);
    const client = createAPIClient<Router>({
      routes: manifest,
      baseURL: "http://farm.test",
      integrations: false,
    });
    const project = client.projects.$params({ projectId: "p1" });
    expect(fetch).not.toHaveBeenCalled();
    const result = await project.uploads.get({
      params: { uploadId: "u1" },
      query: { format: "full" },
    });
    expectTypeOf(result.data).toEqualTypeOf<
      { id: string; projectId: string; format: "short" | "full" } | undefined
    >();
    expect(result.data).toEqual({ id: "u1", projectId: "p1", format: "full" });
    const other = await client.projects
      .$params({ projectId: "p2" })
      .uploads.$params({ uploadId: "u2" })
      .get();
    expect(other.data?.projectId).toBe("p2");
    expect(other.key).not.toBe(result.key);

    // Type-only assertions: invalid calls must never make a request.
    const invalidCalls = () => {
      // @ts-expect-error projectId is required at this scope.
      client.projects.$params({ uploadId: "u1" });
      // @ts-expect-error uploadId remains required after project binding.
      project.uploads.get();
      // @ts-expect-error only registered methods exist.
      project.uploads.delete();
      // @ts-expect-error validated body is required.
      project.uploads.post({ headers: { "x-test-token": "token" } });
      // @ts-expect-error headers validator contributes required request input.
      project.uploads.post({ body: { name: "test" } });
      // @ts-expect-error query enum is inferred from the schema.
      project.uploads.get({ params: { uploadId: "u1" }, query: { format: "bad" } });
      // @ts-expect-error a fully bound resource cannot replace its project ID.
      project.uploads.$params({ uploadId: "u1" }).get({ params: { projectId: "p2" } });
    };
    void invalidCalls;
  });

  it("awaits async body, query, headers and params validation before invoking the handler", async () => {
    const handler = vi.fn((_request, { input }) => input);
    const route = createRouteFactory().post("/api/items/[id]", {
      input: {
        params: z.object({ id: z.string().transform(async (value) => Number(value)) }),
        body: z.object({ title: z.string().refine(async (value) => value !== "invalid") }),
        query: z.object({
          page: z
            .string()
            .default("1")
            .transform(async (value) => Number(value)),
        }),
        headers: z.object({ "x-token": z.string().refine(async (value) => value === "ok") }),
      },
      handler,
    });
    const request = (title: string) =>
      new Request("http://farm.test/api/items/42", {
        method: "POST",
        headers: { "content-type": "application/json", "x-token": "ok" },
        body: JSON.stringify({ title }),
      });
    const good = await invokeAPIRouteEndpoint(route.endpoint, request("hello"), { id: "42" });
    expect((await good.json()).params).toEqual({ id: 42 });
    expect(handler).toHaveBeenCalledTimes(1);
    const bad = await invokeAPIRouteEndpoint(route.endpoint, request("invalid"), { id: "42" });
    expect(bad.status).toBe(400);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("validates JSON output and preserves raw responses and HEAD semantics", async () => {
    const route = createRouteFactory().get("/api/items", {
      output: z.object({ value: z.string() }),
      handler: () => ({ value: 42 }),
    });
    await expect(
      invokeAPIRouteEndpoint(route.endpoint, new Request("http://farm.test/api/items")),
    ).rejects.toThrow("output schema");
    const raw = createRouteFactory().get("/api/raw", {
      output: z.string(),
      handler: () => new Response("stream", { headers: { "x-raw": "yes" } }),
    });
    const response = await invokeAPIRouteEndpoint(
      raw.endpoint,
      new Request("http://farm.test/api/raw", { method: "HEAD" }),
    );
    expect(await response.text()).toBe("");
    expect(response.headers.get("x-raw")).toBe("yes");
  });

  it("infers inline middleware inputs and the provided handler context", async () => {
    const route = createRouteFactory().get("/api/middleware", {
      middleware: [
        ({ request }) => {
          expectTypeOf(request).toEqualTypeOf<Request>();
          return { userId: "user-1" };
        },
      ],
      handler(_request, { context }) {
        expectTypeOf(context.userId).toEqualTypeOf<"user-1">();
        return { id: context.userId };
      },
    });
    const response = await invokeAPIRouteEndpoint(
      route.endpoint,
      new Request("http://farm.test/api/middleware"),
    );
    expect(await response.json()).toEqual({ id: "user-1" });
  });

  it("checks params schemas against the complete composed path", () => {
    const project = createRouteFactory().scope("/api/projects/[projectId]");
    const invalidDefinitions = () => {
      project.get("uploads/[uploadId]", {
        // @ts-expect-error params schemas must include the parent projectId.
        input: { params: z.object({ uploadId: z.string() }) },
        handler: () => null,
      });
      project.get("uploads/[uploadId]", {
        // @ts-expect-error params schemas cannot introduce names absent from the path.
        input: {
          params: z.object({ projectId: z.string(), uploadId: z.string(), otherId: z.string() }),
        },
        handler: () => null,
      });
    };
    void invalidDefinitions;
  });

  it("rejects duplicate methods, ambiguous shapes, and unsafe route definitions", () => {
    expect(() => mergePluginAPIRoutes(routes, [uploads])).toThrow("Duplicate API route");
    const factory = createRouteFactory();
    for (const path of [
      "/outside",
      "/api/../admin",
      "/api/a/[id]/[id]",
      "/api/[...rest]/tail",
      "/api/x?y=1",
    ]) {
      expect(() => factory.get(path, { handler: () => null })).toThrow();
    }
    const ambiguous = definePlugin({
      name: "ambiguous",
      routes: ({ route }) => [
        route.get("/api/projects/[other]/uploads/[uploadId]", { handler: () => null }),
      ],
    });
    expect(() => mergePluginAPIRoutes(routes, [ambiguous])).toThrow("Ambiguous API routes");
  });
});
