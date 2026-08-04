import { describe, expect, it, vi } from "vitest";
import { PluginManager, definePlugin } from "../plugin";
import { createLoggerPlugin } from "../plugins/logger";
import { getRequestContext, getRequestContextSnapshot } from "../request-context";
import type { PageProps } from "../types";

function createManager() {
  return new PluginManager({
    config: {},
    isDev: true,
    isProd: false,
  });
}

describe("plugin lifecycle hooks", () => {
  it("runs every shutdown hook and registered disposer exactly once", async () => {
    const manager = createManager();
    const calls: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "first-resource",
        setup(context) {
          context.lifecycle.onShutdown(() => {
            calls.push("dispose:first");
          });
        },
        shutdown() {
          calls.push("shutdown:first");
          throw new Error("first shutdown failed");
        },
      }),
    );
    manager.addPlugin(
      definePlugin({
        name: "second-resource",
        setup(context) {
          context.lifecycle.onShutdown(() => {
            calls.push("dispose:second");
          });
        },
        shutdown() {
          calls.push("shutdown:second");
        },
      }),
    );

    await manager.startRuntime();
    await expect(manager.closeRuntime("SIGTERM")).rejects.toMatchObject({
      name: "FarmRuntimeShutdownError",
    });
    await expect(manager.closeRuntime("SIGINT")).rejects.toMatchObject({
      name: "FarmRuntimeShutdownError",
    });

    expect(calls).toEqual(["shutdown:first", "shutdown:second", "dispose:second", "dispose:first"]);
  });

  it("routes direct shutdown hook calls through runtime cleanup", async () => {
    const manager = createManager();
    const calls: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "direct-shutdown-resource",
        setup({ lifecycle }) {
          lifecycle.onShutdown(() => {
            calls.push("dispose");
          });
        },
        shutdown() {
          calls.push("shutdown");
          throw new Error("direct shutdown failed");
        },
      }),
    );

    await manager.startRuntime();
    await expect(manager.runHookParallel("shutdown", { reason: "direct" })).rejects.toMatchObject({
      name: "FarmRuntimeShutdownError",
    });
    await expect(manager.closeRuntime("second-close")).rejects.toMatchObject({
      name: "FarmRuntimeShutdownError",
    });

    expect(calls).toEqual(["shutdown", "dispose"]);
  });

  it("indexes request capabilities and invalidates them when plugins are added", () => {
    const manager = createManager();

    manager.addPlugin(createLoggerPlugin());
    expect(manager.hasHook("beforeRequest")).toBe(false);
    expect(manager.hasHook("afterResponse")).toBe(false);
    expect(manager.hasRuntimeRequestHooks()).toBe(false);

    manager.addPlugin(
      createLoggerPlugin({
        beforeRequest() {},
      }),
    );
    expect(manager.hasHook("beforeRequest")).toBe(true);
    expect(manager.hasHook("afterResponse")).toBe(false);

    manager.addPlugin(
      definePlugin({
        name: "runtime-after-capability",
        runtime: {
          after() {},
        },
      }),
    );
    expect(manager.hasRuntimeHook("after")).toBe(true);
    expect(manager.hasRuntimeRequestHooks()).toBe(true);
  });

  it("runs the universal runtime pipeline with typed context and transforms", async () => {
    const manager = createManager();
    const seen: string[] = [];
    const background: Promise<unknown>[] = [];

    manager.addPlugin(
      definePlugin({
        name: "runtime-pipeline",
        setup() {
          return { prefix: "trace" };
        },
        runtime: {
          context({ request, state, req }) {
            const traceId = `${state.prefix}:${new URL(request.url).pathname}`;
            req.set("traceId", traceId);
            return { traceId };
          },
          before({ request, ctx, req }) {
            expect(req.get("traceId")).toBe(ctx.traceId);
            const headers = new Headers(request.headers);
            headers.set("x-trace-id", ctx.traceId);
            seen.push(`before:${ctx.traceId}`);
            return new Request(request, { headers });
          },
          after({ ctx, response, waitUntil }) {
            seen.push(`after:${ctx.traceId}:${response.status}`);
            waitUntil(Promise.resolve(ctx.traceId));
            const headers = new Headers(response.headers);
            headers.set("x-trace-id", ctx.traceId);
            return new Response(response.body, {
              status: response.status,
              headers,
            });
          },
        },
      }),
    );

    const response = await manager.runRuntimeRequest(
      new Request("http://localhost/products"),
      (request) => {
        expect(request.headers.get("x-trace-id")).toBe("trace:/products");
        return new Response("ok", { status: 201 });
      },
      {
        kind: "page",
        waitUntil(promise) {
          background.push(promise);
        },
      },
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("x-trace-id")).toBe("trace:/products");
    expect(await response.text()).toBe("ok");
    expect(seen).toEqual(["before:trace:/products", "after:trace:/products:201"]);
    await expect(Promise.all(background)).resolves.toEqual(["trace:/products"]);
  });

  it("supports runtime short circuits and reports errors", async () => {
    const manager = createManager();
    const handler = vi.fn(() => new Response("handler"));
    const errors: unknown[] = [];

    manager.addPlugin(
      definePlugin({
        name: "runtime-guard",
        runtime: {
          context({ request }) {
            return { authorized: new URL(request.url).pathname !== "/private" };
          },
          before({ ctx }) {
            if (!ctx.authorized) {
              return new Response("Unauthorized", { status: 401 });
            }
          },
          after({ response }) {
            const headers = new Headers(response.headers);
            headers.set("x-plugin", "runtime-guard");
            return new Response(response.body, { status: response.status, headers });
          },
          error({ error }) {
            errors.push(error);
          },
        },
      }),
    );

    const shortCircuit = await manager.runRuntimeRequest(
      new Request("http://localhost/private"),
      handler,
    );
    expect(handler).not.toHaveBeenCalled();
    expect(shortCircuit.status).toBe(401);
    expect(shortCircuit.headers.get("x-plugin")).toBe("runtime-guard");

    manager.addPlugin(
      definePlugin({
        name: "runtime-failure",
        runtime: {
          before() {
            throw new Error("runtime failed");
          },
        },
      }),
    );

    await expect(
      manager.runRuntimeRequest(new Request("http://localhost/failure"), handler),
    ).rejects.toThrow("runtime failed");
    expect(errors).toHaveLength(1);
  });

  it("rejects conflicting runtime context keys", async () => {
    const manager = createManager();

    manager.addPlugins([
      definePlugin({
        name: "first-context",
        runtime: {
          context() {
            return { locale: "en" };
          },
        },
      }),
      definePlugin({
        name: "second-context",
        runtime: {
          context() {
            return { locale: "fr" };
          },
        },
      }),
    ]);

    await expect(
      manager.runRuntimeRequest(new Request("http://localhost"), () => new Response("unreachable")),
    ).rejects.toThrow('context key "locale"');
  });

  it("runs the structured plugin groups with private setup state", async () => {
    const manager = createManager();
    const seen: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "structured-lifecycle",
        setup() {
          seen.push("setup");
          return { prefix: "structured" };
        },
        runtime: {
          start({ state }) {
            seen.push(`${state.prefix}:start`);
          },
          close({ state, reason }) {
            seen.push(`${state.prefix}:close:${reason}`);
          },
        },
        router: {
          discovered(route, { state }) {
            seen.push(`${state.prefix}:route:${route.kind}`);
          },
          generated(routes, { state }) {
            seen.push(`${state.prefix}:routes:${routes.pageCount}`);
          },
          before(route, { state }) {
            seen.push(`${state.prefix}:before-match:${route.pathname}`);
          },
          after(result, { state }) {
            seen.push(`${state.prefix}:after-match:${result.matched}`);
          },
        },
        render: {
          before(render, { state }) {
            seen.push(`${state.prefix}:before-render:${render.pathname}`);
          },
          html(html, _render, { state }) {
            return `${html}<!--${state.prefix}-->`;
          },
        },
        build: {
          before(bundle, { state }) {
            seen.push(`${state.prefix}:before-build:${bundle.preset}`);
          },
          configure(config, { state }) {
            return { ...config, marker: state.prefix };
          },
          after(result, { state }) {
            seen.push(`${state.prefix}:after-build:${result.success}`);
          },
        },
        dev: {
          update(update, { state }) {
            seen.push(`${state.prefix}:hmr:${update.file}`);
          },
        },
      }),
    );

    await manager.setupPlugins();
    await manager.runHookParallel("ready");
    await manager.runHookParallel("apiRouteDiscovered", {
      path: "/api/health",
      filePath: "/tmp/api/health/route.ts",
      methods: ["GET"],
    });
    await manager.runHookParallel("routesGenerated", {
      routes: [],
      pageCount: 1,
      layoutCount: 0,
    });
    await manager.runHookParallel("beforeRouteMatch", {
      pathname: "/health",
      method: "GET",
    });
    await manager.runHookParallel("afterRouteMatch", {
      pathname: "/health",
      matched: true,
      routePattern: "/health",
      params: {},
      layoutPatterns: [],
    });
    await manager.runHookParallel("beforeRender", {
      pathname: "/health",
      method: "GET",
      routePattern: "/health",
      params: {},
    });

    const html = await manager.runHookSerial("afterRender", "<main>ok</main>", {
      pathname: "/health",
      method: "GET",
      routePattern: "/health",
      params: {},
    });
    expect(html).toBe("<main>ok</main><!--structured-->");

    await manager.runHookParallel("beforeBundle", {
      root: "/tmp/app",
      preset: "node-server",
      universal: true,
      distDir: ".farm",
    });
    const buildConfig = await manager.runHookSerial("beforeNitroBuild", {});
    expect(buildConfig.marker).toBe("structured");
    await manager.runHookParallel("afterBundle", {
      root: "/tmp/app",
      preset: "node-server",
      universal: true,
      distDir: ".farm",
      success: true,
    });
    await manager.runHookParallel("hmrUpdate", {
      file: "src/app/page.tsx",
      modules: ["page"],
    });
    await manager.runHookParallel("shutdown", { reason: "test" });

    expect(seen).toEqual([
      "setup",
      "structured:start",
      "structured:route:api",
      "structured:routes:1",
      "structured:before-match:/health",
      "structured:after-match:true",
      "structured:before-render:/health",
      "structured:before-build:node-server",
      "structured:after-build:true",
      "structured:hmr:src/app/page.tsx",
      "structured:close:test",
    ]);
  });

  it("supports extended lifecycle hooks end-to-end", async () => {
    const manager = createManager();
    const seen: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "lifecycle",
        init() {
          seen.push("init");
        },
        ready() {
          seen.push("ready");
        },
        routeDiscovered(route) {
          seen.push(`route:${route.pattern}`);
        },
        routesGenerated(routes) {
          seen.push(`routes:${routes.pageCount}/${routes.layoutCount}`);
        },
        middlewareDiscovered(mw) {
          seen.push(`middleware:${mw.path}`);
        },
        apiRouteDiscovered(route) {
          seen.push(`api:${route.path}`);
        },
        beforeRouteMatch(route) {
          seen.push(`before-match:${route.pathname}`);
        },
        afterRouteMatch(result) {
          seen.push(`after-match:${result.matched}`);
        },
        beforeRender(render) {
          seen.push(`before-render:${render.pathname}`);
        },
        afterRender(html) {
          seen.push("after-render");
          return html + "<!--after-render-->";
        },
        beforeApiHandler(request, _api, context) {
          seen.push("before-api");
          context.req.set("api.phase", "before");
          const headers = new Headers(request.headers);
          headers.set("x-hook", "before");
          return new Request(request, { headers });
        },
        afterApiHandler(response) {
          seen.push("after-api");
          return new Response(response.body, {
            status: 201,
            headers: response.headers,
          });
        },
        hmrUpdate(update) {
          seen.push(`hmr:${update.file}`);
        },
        beforeBundle(payload) {
          seen.push(`before-bundle:${payload.preset}`);
        },
        afterBundle(payload) {
          seen.push(`after-bundle:${payload.success}`);
        },
        beforeNitroBuild(config) {
          seen.push("before-nitro");
          return { ...config, testFlag: true };
        },
        afterNitroBuild(payload) {
          seen.push(`after-nitro:${payload.preset}`);
        },
        shutdown(payload) {
          seen.push(`shutdown:${payload.reason}`);
        },
      }),
    );

    await manager.runHookParallel("init");
    await manager.runHookParallel("ready");

    await manager.runHookParallel("routeDiscovered", {
      kind: "page",
      pattern: "/docs",
      modulePath: "/tmp/docs/page.tsx",
    });
    await manager.runHookParallel("routesGenerated", {
      routes: [],
      pageCount: 2,
      layoutCount: 1,
    });
    await manager.runHookParallel("middlewareDiscovered", {
      path: "/",
      filePath: "/tmp/middleware.ts",
      handlerCount: 1,
    });
    await manager.runHookParallel("apiRouteDiscovered", {
      path: "/api/health",
      filePath: "/tmp/api/health/route.ts",
      methods: ["GET"],
    });

    await manager.runHookParallel("beforeRouteMatch", {
      pathname: "/docs",
      method: "GET",
    });
    await manager.runHookParallel("afterRouteMatch", {
      pathname: "/docs",
      matched: true,
      routePattern: "/docs",
      params: {},
      layoutPatterns: ["/"],
    });

    await manager.runHookParallel("beforeRender", {
      pathname: "/docs",
      method: "GET",
      routePattern: "/docs",
      params: {},
    });

    const html = await manager.runHookSerial("afterRender", "<html><body>ok</body></html>", {
      pathname: "/docs",
      method: "GET",
      routePattern: "/docs",
      params: {},
    });
    expect(html).toContain("after-render");

    const request = new Request("http://localhost/api/health");
    const modifiedRequest = await manager.runHookSerial("beforeApiHandler", request, {
      pathname: "/api/health",
      method: "GET",
      routePath: "/api/health",
    });
    expect(modifiedRequest.headers.get("x-hook")).toBe("before");
    expect(getRequestContext(request, "api.phase")).toBe("before");
    expect(getRequestContext(modifiedRequest, "api.phase")).toBe("before");

    const response = new Response("ok", { status: 200 });
    const modifiedResponse = await manager.runHookSerial("afterApiHandler", response, {
      pathname: "/api/health",
      method: "GET",
      routePath: "/api/health",
    });
    expect(modifiedResponse.status).toBe(201);

    await manager.runHookParallel("hmrUpdate", {
      file: "src/app/page.tsx",
      modules: ["id:a"],
    });
    await manager.runHookParallel("beforeBundle", {
      root: "/tmp/app",
      preset: "node-server",
      universal: true,
      distDir: ".farm",
    });
    await manager.runHookParallel("afterBundle", {
      root: "/tmp/app",
      preset: "node-server",
      universal: true,
      distDir: ".farm",
      success: true,
    });

    const nitroConfig = await manager.runHookSerial("beforeNitroBuild", { preset: "node-server" });
    expect(nitroConfig.testFlag).toBe(true);

    await manager.runHookParallel("afterNitroBuild", {
      root: "/tmp/app",
      preset: "node-server",
      distDir: ".farm",
      outputDir: "/tmp/app/.farm/.output",
    });
    await manager.runHookParallel("shutdown", { reason: "test" });

    expect(seen).toContain("init");
    expect(seen).toContain("ready");
    expect(seen).toContain("before-api");
    expect(seen).toContain("after-api");
    expect(seen).toContain("before-nitro");
    expect(seen).toContain("shutdown:test");
  });

  it("keeps ctx.req data across transformed API requests", async () => {
    const manager = createManager();
    const observed: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "api-request-writer",
        beforeApiHandler(request, _api, context) {
          context.req.set("traceId", "trace-123", { exposeToPage: true });
          const headers = new Headers(request.headers);
          headers.set("x-first-plugin", "yes");
          return new Request(request, { headers });
        },
      }),
    );
    manager.addPlugin(
      definePlugin({
        name: "api-request-reader",
        beforeApiHandler(request, _api, context) {
          observed.push(context.req.get<string>("traceId") || "missing");
          const headers = new Headers(request.headers);
          headers.set("x-second-plugin", "yes");
          return new Request(request, { headers });
        },
      }),
    );

    const request = new Request("http://localhost/api/health");
    const result = await manager.runHookSerial("beforeApiHandler", request, {
      pathname: "/api/health",
      method: "GET",
    });

    expect(observed).toEqual(["trace-123"]);
    expect(result.headers.get("x-first-plugin")).toBe("yes");
    expect(result.headers.get("x-second-plugin")).toBe("yes");
    expect(getRequestContext(result, "traceId")).toBe("trace-123");
    expect(getRequestContextSnapshot(result, { exposedOnly: true }).get("traceId")).toBe(
      "trace-123",
    );
  });

  it("keeps enforce ordering for lifecycle hooks", async () => {
    const manager = createManager();
    const order: string[] = [];

    manager.addPlugin(
      definePlugin({
        name: "normal",
        beforeBundle() {
          order.push("normal");
        },
      }),
    );
    manager.addPlugin(
      definePlugin({
        name: "pre",
        enforce: "pre",
        beforeBundle() {
          order.push("pre");
        },
      }),
    );
    manager.addPlugin(
      definePlugin({
        name: "post",
        enforce: "post",
        beforeBundle() {
          order.push("post");
        },
      }),
    );

    await manager.runHookParallel("beforeBundle", {
      root: "/tmp/app",
      preset: "node-server",
      universal: true,
      distDir: ".farm",
    });

    expect(order).toEqual(["pre", "normal", "post"]);
  });

  it("runs request hooks sequentially and can short-circuit", async () => {
    const manager = createManager();
    const first = vi.fn((_req: any, res: any) => {
      res.writableEnded = true;
    });
    const second = vi.fn();

    manager.addPlugin(
      definePlugin({
        name: "first",
        beforeRequest: first as any,
      }),
    );
    manager.addPlugin(
      definePlugin({
        name: "second",
        beforeRequest: second as any,
      }),
    );

    const req: any = {};
    const res: any = { writableEnded: false };
    const ended = await manager.runHookParallel("beforeRequest", req, res);

    expect(ended).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(0);
  });

  it("provides a bound ctx.req store while preserving the legacy requestContext alias", async () => {
    const manager = createManager();
    const observed: Array<string | undefined> = [];
    let legacyTraceId: string | undefined;

    manager.addPlugin(
      definePlugin({
        name: "setter",
        beforeRequest(_req, _res, context) {
          context.req.set("traceId", "trace-123", { exposeToPage: true });
          context.req.set("internalToken", "secret-token");
        },
      }),
    );

    manager.addPlugin(
      definePlugin({
        name: "reader",
        beforeRequest(req, _res, context) {
          observed.push(context.req.get<string>("traceId"));
          observed.push(context.req.get<string>("internalToken"));
          const exposed = context.req.snapshot({ exposedOnly: true });
          observed.push(exposed.get("traceId") as string | undefined);
          observed.push(exposed.get("internalToken") as string | undefined);
          legacyTraceId = context.requestContext.get(req, "traceId");
        },
        afterResponse(_req, _res, context) {
          observed.push(context.req.get<string>("traceId"));
        },
      }),
    );

    const req: any = {};
    const res: any = { writableEnded: false };
    await manager.runHookParallel("beforeRequest", req, res);
    await manager.runHookParallel("afterResponse", req, res);

    expect(observed).toEqual(["trace-123", "secret-token", "trace-123", undefined, "trace-123"]);
    expect(legacyTraceId).toBe("trace-123");

    const exposedFromStore = getRequestContextSnapshot(req, { exposedOnly: true });
    expect(exposedFromStore.get("traceId")).toBe("trace-123");
    expect(exposedFromStore.get("internalToken")).toBeUndefined();
  });

  it("uses props.context for plugin-exposed values on page props", () => {
    const props: PageProps = {
      params: {},
      searchParams: Promise.resolve({}),
      path: "/",
      context: { data: new Map([["traceId", "trace-123"]]) },
    };

    expect(props.context?.data.get("traceId")).toBe("trace-123");
  });
});
