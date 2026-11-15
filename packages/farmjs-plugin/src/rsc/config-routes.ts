import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { ResolvedFarmI18nConfig } from "@farm.js/core/i18n";
import type { Connect } from "vite";
import { devServableFileExists } from "../dev-static.js";
import { createDevRequestHeaders, resolveDevRequestURL } from "../dev-request.js";
import { sendRscDevelopmentResponse } from "./dev-response.js";
import type { HeaderConfig, RedirectConfig, RewriteConfig } from "./types.js";

const require_ = createRequire(import.meta.url);

/** A config `redirects`, `rewrites` or `headers` value: an array, or a function returning one. */
export type RscConfigRouteList<T> = readonly T[] | (() => readonly T[] | Promise<readonly T[]>);

export interface RscConfigRoutes {
  redirects: RedirectConfig[];
  rewrites: RewriteConfig[];
  headers: HeaderConfig[];
}

async function resolveRscConfigRouteList<T>(
  value: RscConfigRouteList<T> | undefined,
  field: string,
): Promise<T[]> {
  const list = typeof value === "function" ? await value() : (value ?? []);
  if (!Array.isArray(list)) {
    throw new TypeError(`[Farm.js] ${field} must be an array or a function that returns one.`);
  }
  return [...list];
}

/**
 * The config `redirects()`, `rewrites()` and `headers()`, called once as core's config resolution
 * calls them. `undefined` when none has an entry, so such an app generates the same entries.
 */
export async function resolveRscConfigRoutes(config: {
  redirects?: RscConfigRouteList<RedirectConfig>;
  rewrites?: RscConfigRouteList<RewriteConfig>;
  headers?: RscConfigRouteList<HeaderConfig>;
}): Promise<RscConfigRoutes | undefined> {
  const [redirects, rewrites, headers] = await Promise.all([
    resolveRscConfigRouteList(config.redirects, "redirects"),
    resolveRscConfigRouteList(config.rewrites, "rewrites"),
    resolveRscConfigRouteList(config.headers, "headers"),
  ]);
  if (redirects.length === 0 && rewrites.length === 0 && headers.length === 0) return undefined;
  return { redirects, rewrites, headers };
}

type ConfigRouteMatchers = Pick<
  typeof import("@farm.js/core/internal/production-runtime"),
  "createConfigHeadersMatcher" | "createConfigRedirectMatcher" | "createConfigRewriteMatcher"
>;

export interface RscDevConfigRoutes {
  redirect: ReturnType<ConfigRouteMatchers["createConfigRedirectMatcher"]>;
  rewrite: ReturnType<ConfigRouteMatchers["createConfigRewriteMatcher"]>;
  headers: ReturnType<ConfigRouteMatchers["createConfigHeadersMatcher"]>;
  hasRewrites: boolean;
}

/**
 * Core's matchers for the resolved config routes. Creating them checks each source and redirect
 * status as core does, so `farm dev` and `farm build` fail on the same config.
 */
export function createRscConfigRouteMatchers(
  routes: RscConfigRoutes,
  options: { i18n: ResolvedFarmI18nConfig; basePath: string },
): RscDevConfigRoutes {
  const { createConfigHeadersMatcher, createConfigRedirectMatcher, createConfigRewriteMatcher } =
    require_("@farm.js/core/internal/production-runtime") as ConfigRouteMatchers;
  return {
    redirect: createConfigRedirectMatcher(routes.redirects, options),
    rewrite: createConfigRewriteMatcher(routes.rewrites, options),
    headers: createConfigHeadersMatcher(routes.headers, options),
    hasRewrites: routes.rewrites.length > 0,
  };
}

type DevServerHelpers = Pick<
  typeof import("@farm.js/core/vite"),
  "installConfigResponseHeaders" | "isViteDevClientRequest" | "isViteModuleRequest"
>;

export interface RscConfigRoutesMiddlewareOptions {
  routes: () => RscDevConfigRoutes | undefined;
  root: string;
  publicDir: string | false;
  isApiPathname: (pathname: string) => boolean;
  /** Whether the RSC entry answers the URL itself, which a config rewrite yields to. */
  hasLocalRoute: (url: URL) => Promise<boolean>;
  bodySizeLimit: number;
}

/** The page a '<page>.rsc' payload request is for, as the RSC entry reads it. */
function toPayloadPageUrl(url: URL): URL {
  const pageUrl = new URL(url);
  const page = url.pathname.slice(0, -".rsc".length);
  pageUrl.pathname = page.endsWith("/index") ? page.slice(0, -"index".length) : page;
  return pageUrl;
}

function toPayloadPath(pathname: string): string {
  return pathname.endsWith("/") ? `${pathname}index.rsc` : `${pathname}.rsc`;
}

/**
 * The config `headers()`, `redirects()` and `rewrites()` under `farm dev`, ahead of Vite, the API
 * routes and the RSC entry, as core's dev server applies them: headers and redirects see the URL
 * as requested, and a rewrite applies when no route answers it, once. Requests the running app
 * makes for Vite's modules and files, and public files, stay Vite's (#2685). A payload request
 * ('<page>.rsc') matches as its page, as in production.
 */
export function createRscConfigRoutesMiddleware(
  options: RscConfigRoutesMiddlewareOptions,
): Connect.NextHandleFunction {
  let helpers: DevServerHelpers | undefined;
  return async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
    const routes = options.routes();
    if (!routes) return next();
    helpers ??= require_("@farm.js/core/vite") as DevServerHelpers;

    let url: URL;
    try {
      url = resolveDevRequestURL(req);
    } catch {
      return next();
    }
    const method = (req.method || "GET").toUpperCase();
    const rawUrl = req.url || "/";
    const viteOwned =
      rawUrl.startsWith("/@") ||
      rawUrl.startsWith("/node_modules/") ||
      rawUrl.startsWith("/__farm/") ||
      helpers.isViteModuleRequest(url, req.headers) ||
      ((method === "GET" || method === "HEAD") &&
        url.pathname.includes(".") &&
        (devServableFileExists(url.pathname, [options.publicDir || undefined]) ||
          (helpers.isViteDevClientRequest(url, req.headers) &&
            devServableFileExists(url.pathname, [options.root]))));
    if (viteOwned) return next();

    const payloadRequested =
      (method === "GET" || method === "HEAD") &&
      url.pathname.endsWith(".rsc") &&
      !options.isApiPathname(url.pathname);
    const routeUrl = payloadRequested ? toPayloadPageUrl(url) : url;

    try {
      helpers.installConfigResponseHeaders(res as never, routes.headers(routeUrl));

      const redirect = routes.redirect(routeUrl);
      if (redirect) {
        let location = redirect.destination;
        if (payloadRequested) {
          const target = new URL(location, url);
          if (target.origin === url.origin)
            location = toPayloadPath(target.pathname) + target.search;
        }
        await sendRscDevelopmentResponse(
          res,
          new Response(`Redirecting to ${location}`, {
            status: redirect.statusCode,
            headers: { Location: location },
          }),
        );
        return;
      }

      if (routes.hasRewrites) {
        const destination = routes.rewrite(routeUrl);
        if (destination && !(await options.hasLocalRoute(routeUrl))) {
          if (destination.origin !== url.origin) {
            const { readNodeRequestBody, fetchFarmExternalRewrite } = require_(
              "@farm.js/core/internal/production-runtime",
            ) as typeof import("@farm.js/core/internal/production-runtime");
            const body =
              method === "GET" || method === "HEAD"
                ? undefined
                : await readNodeRequestBody(req, options.bodySizeLimit);
            await sendRscDevelopmentResponse(
              res,
              await fetchFarmExternalRewrite(
                new Request(destination, {
                  method,
                  headers: createDevRequestHeaders(req.headers),
                  body: body && body.length > 0 ? new Uint8Array(body) : undefined,
                }),
              ),
            );
            return;
          }
          req.url =
            (payloadRequested ? toPayloadPath(destination.pathname) : destination.pathname) +
            destination.search;
        }
      }
    } catch (error) {
      console.error("[Farm.js] Config route failed:", error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.end("Internal Server Error");
      return;
    }
    next();
  };
}
