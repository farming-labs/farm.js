// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { APIClientError, createApiClients } from "../api/client";
import { createEndpoint } from "../api/endpoint";
import { createRouteFactory } from "../api/route";
import {
  invokeAPIRouteEndpoint,
  matchAPIRouteAtBasePath,
  resolveAPIRouteEndpoint,
} from "../api/runtime";
import { _runWithAPIRequestRuntime } from "../api/server-context";
import { _runWithCurrentRequest, getCurrentRequest } from "../server/request";
import { jsonStream } from "../api/transport";
import { defineIntegration, integrationRoute, resolveIntegrationPlugins } from "../integrations";
import { endpoint } from "../integration-api";
import { PluginManager } from "../plugin";

const route = createRouteFactory();
const detail = route.get("/api/projects/[projectId]/files/[fileId]", {
  input: { query: z.object({ tag: z.array(z.string()).optional() }) },
  middleware: [
    ({ request }) => {
      if (!request.headers.get("authorization"))
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      return { authenticated: true };
    },
  ],
  handler(request, { input, context }) {
    return {
      id: `${input.params.projectId}/${input.params.fileId}`,
      tags: input.query.tag ?? [],
      authorization: request.headers.get("authorization"),
      cookie: request.headers.get("cookie"),
      length: request.headers.get("content-length"),
      url: getCurrentRequest().url,
      authenticated: context.authenticated,
    };
  },
});
const update = route.post("/api/projects/[projectId]/files/[fileId]", {
  input: { body: z.object({ title: z.string().trim().min(1) }) },
  output: z.object({ title: z.string() }),
  handler: (_request, { input }) => input.body,
});
const failure = createEndpoint(
  {
    method: "POST",
    errors: { conflict: { status: 409, data: z.object({ id: z.string() }) } },
  },
  ({ error }) => error("conflict", { id: "taken" }),
);
const stream = createEndpoint({ method: "GET" }, () => jsonStream([{ value: 1 }, { value: 2 }]));
type Router = {
  projects: {
    "[projectId]": {
      files: { "[fileId]": { get: typeof detail.endpoint; post: typeof update.endpoint } };
    };
  };
  failure: { post: typeof failure };
  stream: { get: typeof stream };
};
const routes = [
  { path: detail.path, methods: ["GET", "POST"] },
  { path: "/api/failure", methods: ["POST"] },
  { path: "/api/stream", methods: ["GET"] },
] as const;
const table = new Map([
  [
    detail.path,
    {
      path: detail.path,
      endpoints: { GET: detail.endpoint, POST: update.endpoint },
      methods: ["GET", "POST"],
    },
  ],
  ["/api/failure", { path: "/api/failure", endpoints: { POST: failure }, methods: ["POST"] }],
  ["/api/stream", { path: "/api/stream", endpoints: { GET: stream }, methods: ["GET"] }],
]);

function createRuntime(basePath = "/backend/v2") {
  return {
    basePath,
    dispatch: vi.fn(async (request: Request) => {
      const match = matchAPIRouteAtBasePath(table, new URL(request.url).pathname, basePath);
      if (!match) return Response.json({ error: "Not Found" }, { status: 404 });
      const endpoint = resolveAPIRouteEndpoint(match.route, request.method);
      if (!endpoint) return Response.json({ error: "Method Not Allowed" }, { status: 405 });
      return invokeAPIRouteEndpoint(endpoint, request, match.params);
    }),
  };
}
const authenticatedRequest = () =>
  new Request("https://farm.test/page", {
    headers: { authorization: "Bearer alice", cookie: "session=alice", "content-length": "9000" },
  });
const input = { params: { fileId: "report 1" }, query: { tag: ["a", "b"] } };
const cached = { cache: { staleTime: 60_000 } };

afterEach(() => vi.unstubAllGlobals());

describe("createApiClients", () => {
  it("preserves integration aliases and shared options on both callers", async () => {
    const integration = defineIntegration({
      category: "custom",
      type: "paired-check",
      instance: {},
      routes: [
        integrationRoute.get("/api/paired-check/message", {
          responseFormat: "json",
          handler: (request) => Response.json({ value: request.headers.get("x-shared") }),
        }),
      ],
    });
    const manager = new PluginManager({
      config: { integrations: { pairedCheck: integration } } as any,
      isDev: true,
      isProd: false,
    });
    manager.addPlugins(resolveIntegrationPlugins({ pairedCheck: integration }));
    await manager.runHookParallel("init");
    const fetchSpy = vi.fn(async () => Response.json({ value: "browser" }));
    vi.stubGlobal("fetch", fetchSpy);
    const { api, apiClient } = createApiClients<Router, { pairedCheck: typeof integration }>({
      routes,
      headers: { "x-shared": "one-setup" },
    });
    const result = await _runWithCurrentRequest(authenticatedRequest(), () =>
      api.integrations.pairedCheck.message.get(),
    );
    expect(result.error).toBeNull();
    expect(result.data).toEqual({ value: "one-setup" });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.stubGlobal("window", {
      location: { origin: "https://farm.test" },
      __FARM_INTEGRATION_API_MANIFEST__: {
        pairedCheck: {
          message: endpoint.route(
            "/api/paired-check/message",
            endpoint.get({ responseFormat: "json" }),
          ),
        },
      },
    });
    await apiClient.integrations.pairedCheck.message.get();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const headers = new Headers((fetchSpy.mock.calls[0] as any)[1].headers);
    expect(headers.get("x-shared")).toBe("one-setup");
  });

  it("uses one shared setup for HTTP and direct calls with the same inferred routes", async () => {
    const { api, apiClient } = createApiClients<Router>({ routes, integrations: false });
    expectTypeOf(api).toEqualTypeOf(apiClient);
    const fetchSpy = vi.fn(async () => Response.json({ title: "HTTP" }));
    vi.stubGlobal("fetch", fetchSpy);
    const runtime = createRuntime();
    const result = await _runWithAPIRequestRuntime(runtime, () =>
      _runWithCurrentRequest(authenticatedRequest(), () =>
        api.projects.$params({ projectId: "p1" }).files.get(input),
      ),
    );
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      id: "p1/report 1",
      tags: ["a", "b"],
      authorization: "Bearer alice",
      cookie: "session=alice",
      length: null,
      authenticated: true,
      url: "https://farm.test/backend/v2/projects/p1/files/report%201?tag=a&tag=b",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runtime.dispatch).toHaveBeenCalledOnce();
    const response = await apiClient.projects
      .$params({ projectId: "p1" })
      .files.post({ params: { fileId: "f1" }, body: { title: "HTTP" } });
    expect(response.data).toEqual({ title: "HTTP" });
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it("validates local bodies and runs endpoint authorization instead of raw handlers", async () => {
    const { api } = createApiClients<Router>({ routes });
    await _runWithAPIRequestRuntime(createRuntime(), () =>
      _runWithCurrentRequest(new Request("https://farm.test/page"), async () => {
        const files = api.projects.$params({ projectId: "p1" }).files;
        const denied = await files.get(input);
        expect(denied.error).toMatchObject({ status: 401 });
        const invalid = await files.post({ params: { fileId: "f1" }, body: { title: " " } });
        expect(invalid.error).toMatchObject({ status: 400 });
        const valid = await files.post({ params: { fileId: "f1" }, body: { title: "  Valid  " } });
        expect(valid.data).toEqual({ title: "Valid" });
      }),
    );
  });

  it("retains typed error and streaming response contracts locally", async () => {
    const { api } = createApiClients<Router>({ routes });
    await _runWithAPIRequestRuntime(createRuntime(), () =>
      _runWithCurrentRequest(authenticatedRequest(), async () => {
        const failed = await api.failure.post();
        expect(failed.error).toBeInstanceOf(APIClientError);
        expect(failed.error).toMatchObject({
          code: "conflict",
          status: 409,
          data: { id: "taken" },
        });
        const result = await api.stream.get();
        const values = [];
        for await (const value of result.data!) values.push(value);
        expect(values).toEqual([{ value: 1 }, { value: 2 }]);
      }),
    );
  });

  it("does not retain cached identity across concurrent server requests", async () => {
    const { api } = createApiClients<Router>({ routes });
    const runtime = createRuntime();
    const files = api.projects.$params({ projectId: "p1" }).files;
    const results = await _runWithAPIRequestRuntime(runtime, () =>
      Promise.all(
        ["alice", "bob"].map((user) =>
          _runWithCurrentRequest(
            new Request("https://farm.test/page", {
              headers: { authorization: `Bearer ${user}` },
            }),
            async () => {
              const first = await files.get(input, cached);
              await Promise.resolve();
              const second = await files.get(input, cached);
              expect(first.data).toEqual(second.data);
              return first.data?.authorization;
            },
          ),
        ),
      ),
    );
    expect(results).toEqual(["Bearer alice", "Bearer bob"]);
    expect(runtime.dispatch).toHaveBeenCalledTimes(2);
  });

  it("isolates explicit per-call identities even within one request", async () => {
    const { api } = createApiClients<Router>({ routes });
    await _runWithAPIRequestRuntime(createRuntime(), () =>
      _runWithCurrentRequest(authenticatedRequest(), async () => {
        const files = api.projects.$params({ projectId: "p1" }).files;
        expect((await files.get(input, cached)).data?.authorization).toBe("Bearer alice");
        const other = await (files.get as any)(
          { ...input, headers: { authorization: "Bearer bob" } },
          cached,
        );
        expect(other.data.authorization).toBe("Bearer bob");
      }),
    );
  });

  it("invalidates local scoped references at the actual server base path", async () => {
    const { api } = createApiClients<Router>({ routes });
    const runtime = createRuntime();
    await _runWithAPIRequestRuntime(runtime, () =>
      _runWithCurrentRequest(authenticatedRequest(), async () => {
        const files = api.projects.$params({ projectId: "p1" }).files;
        await files.get(input, cached);
        await files.get(input, cached);
        expect(runtime.dispatch).toHaveBeenCalledOnce();
        await files.post(
          { params: { fileId: "report 1" }, body: { title: "New" } },
          { invalidate: [[files.get, input]] },
        );
        await files.get(input, cached);
        expect(runtime.dispatch).toHaveBeenCalledTimes(3);
      }),
    );
  });

  it("uses the owning app when the same Request is dispatched by different runtimes", async () => {
    const { api } = createApiClients<Router>({ routes });
    const shared = authenticatedRequest();
    const first = createRuntime("/one");
    const second = createRuntime("/two");
    const call = (runtime: ReturnType<typeof createRuntime>) =>
      _runWithAPIRequestRuntime(runtime, () =>
        _runWithCurrentRequest(shared, () =>
          api.projects.$params({ projectId: "p1" }).files.get(input, cached),
        ),
      );
    const [a, b] = await Promise.all([call(first), call(second)]);
    expect(a.data?.url).toContain("/one/projects/");
    expect(b.data?.url).toContain("/two/projects/");
  });

  it("never forwards server cookies to a configured external browser API origin", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = createApiClients<Router>({ routes, baseURL: "https://other.test/v1" });
    const result = await _runWithAPIRequestRuntime(createRuntime(), () =>
      _runWithCurrentRequest(authenticatedRequest(), () =>
        api.projects.$params({ projectId: "p1" }).files.get(input),
      ),
    );
    expect(result.data?.url).toContain("https://farm.test/backend/v2/");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects browser and out-of-request server use without falling back to fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api } = createApiClients<Router>({ routes });
    await expect(api.stream.get()).rejects.toThrow("active Farm server request");
    vi.stubGlobal("window", {});
    await expect(api.stream.get()).rejects.toThrow("server-only");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates request cancellation without invoking an endpoint", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = new Request("https://farm.test/page", { signal: controller.signal });
    const runtime = createRuntime();
    const { api } = createApiClients<Router>({ routes });
    const result = await _runWithAPIRequestRuntime(runtime, () =>
      _runWithCurrentRequest(request, () => api.stream.get()),
    );
    expect(result.error).not.toBeNull();
    expect(runtime.dispatch).not.toHaveBeenCalled();
  });
});
