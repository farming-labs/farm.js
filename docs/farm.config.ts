import { defineFarmConfig, definePlugin } from "@farmjs/core";
import { createLoggerPlugin } from "@farmjs/core/plugin/server";
import { randomUUID } from "crypto";

function createDocsContextDemoPlugin(options: {
  userHeader?: string;
  defaultUser?: string;
  log?: boolean;
  logLifecycle?: boolean;
  onInit?: () => void;
  onReady?: () => void;
  onBeforeRequest?: (payload: { pathname: string; user: string; requestId: string }) => void;
  onAfterResponse?: (payload: {
    pathname: string;
    user: string;
    requestId: string;
    statusCode: number;
  }) => void;
} = {}) {
  const userHeader = (options.userHeader || "x-docs-user").toLowerCase();
  const defaultUser = options.defaultUser || "guest";
  const log = options.log ?? true;
  const logLifecycle = options.logLifecycle ?? true;

  return definePlugin({
    name: "docs-context-demo",
    enforce: "pre",
    init() {
      options.onInit?.();
      if (logLifecycle) console.log("[docs-context-demo] init");
    },
    ready() {
      options.onReady?.();
      if (logLifecycle) console.log("[docs-context-demo] ready");
    },
    configResolved() {
      if (logLifecycle) console.log("[docs-context-demo] configResolved");
    },
    buildStart() {
      if (logLifecycle) console.log("[docs-context-demo] buildStart");
    },
    buildEnd() {
      if (logLifecycle) console.log("[docs-context-demo] buildEnd");
    },
    routeDiscovered(route) {
      if (logLifecycle) console.log(`[docs-context-demo] routeDiscovered ${route.kind} ${route.pattern}`);
    },
    routesGenerated(payload) {
      if (logLifecycle) {
        console.log(
          `[docs-context-demo] routesGenerated pages=${payload.pageCount} layouts=${payload.layoutCount}`,
        );
      }
    },
    middlewareDiscovered(mw) {
      if (logLifecycle) console.log(`[docs-context-demo] middlewareDiscovered ${mw.path}`);
    },
    apiRouteDiscovered(route) {
      if (logLifecycle) console.log(`[docs-context-demo] apiRouteDiscovered ${route.path}`);
    },
    beforeRouteMatch(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] beforeRouteMatch ${payload.pathname}`);
    },
    afterRouteMatch(payload) {
      if (logLifecycle) {
        console.log(
          `[docs-context-demo] afterRouteMatch ${payload.pathname} matched=${payload.matched}`,
        );
      }
    },
    beforeRender(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] beforeRender ${payload.pathname}`);
    },
    afterRender(html, payload) {
      if (logLifecycle) console.log(`[docs-context-demo] afterRender ${payload.pathname}`);
      return html;
    },
    beforeApiHandler(request, payload) {
      if (logLifecycle) console.log(`[docs-context-demo] beforeApiHandler ${payload.pathname}`);
      return request;
    },
    afterApiHandler(response, payload) {
      if (logLifecycle) console.log(`[docs-context-demo] afterApiHandler ${payload.pathname}`);
      return response;
    },
    beforeBundle(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] beforeBundle preset=${payload.preset}`);
    },
    afterBundle(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] afterBundle success=${payload.success}`);
    },
    beforeNitroBuild(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] beforeNitroBuild preset=${payload.preset}`);
      return payload;
    },
    afterNitroBuild(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] afterNitroBuild preset=${payload.preset}`);
    },
    hmrUpdate(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] hmrUpdate file=${payload.file}`);
    },
    onError(payload) {
      console.error(`[docs-context-demo] onError phase=${payload.phase}`, payload.error);
    },
    shutdown(payload) {
      if (logLifecycle) console.log(`[docs-context-demo] shutdown reason=${payload.reason}`);
    },
    beforeRequest(req, _res, context) {
      const pathname = req.url ? req.url.split("?")[0] : "/";
      const headerUser = req.headers[userHeader];
      const userFromHeader = Array.isArray(headerUser) ? headerUser[0] : headerUser;
      const requestId = randomUUID();
      const user = userFromHeader || defaultUser;
      context.requestContext.set(req, "demo.requestId", requestId, { exposeToPage: true });
      context.requestContext.set(req, "demo.path", pathname, { exposeToPage: true });
      context.requestContext.set(req, "demo.user", user, { exposeToPage: true });
      context.requestContext.set(req, "internal.startTs", Date.now());
      options.onBeforeRequest?.({ pathname, user, requestId });

      if (log) {
        console.log(`[docs-context-demo] ${req.method || "GET"} ${pathname} user=${user} id=${requestId}`);
      }
    },
    afterResponse(req, res, context) {
      const pathname = req.url ? req.url.split("?")[0] : "/";
      const user = context.requestContext.get<string>(req, "demo.user") || defaultUser;
      const requestId = context.requestContext.get<string>(req, "demo.requestId") || "unknown";
      const statusCode = res.statusCode || 200;
      options.onAfterResponse?.({ pathname, user, requestId, statusCode });
      if (log) {
        console.log(`[docs-context-demo] done ${statusCode} ${pathname} user=${user} id=${requestId}`);
      }
    },
  });
}

export default defineFarmConfig({
  srcDir: "src",
  preset: "vercel",
  // suppressLintOnLink: true, // set to true to allow any string on <Link href="..."> (no route-type errors)
  notFound: {
    component: "./src/app/not-found.tsx",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  plugins: [createDocsContextDemoPlugin({ log: true, logLifecycle: true }), createLoggerPlugin({})],
});
