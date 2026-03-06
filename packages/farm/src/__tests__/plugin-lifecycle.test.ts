import { describe, expect, it, vi } from "vitest";
import { PluginManager, definePlugin } from "../plugin";

function createManager() {
  return new PluginManager({
    config: {},
    isDev: true,
    isProd: false,
  });
}

describe("plugin lifecycle hooks", () => {
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
        beforeApiHandler(request) {
          seen.push("before-api");
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

    const html = await manager.runHookSerial(
      "afterRender",
      "<html><body>ok</body></html>",
      {
        pathname: "/docs",
        method: "GET",
        routePattern: "/docs",
        params: {},
      },
    );
    expect(html).toContain("after-render");

    const request = new Request("http://localhost/api/health");
    const modifiedRequest = await manager.runHookSerial("beforeApiHandler", request, {
      pathname: "/api/health",
      method: "GET",
      routePath: "/api/health",
    });
    expect(modifiedRequest.headers.get("x-hook")).toBe("before");

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
});
