import { describe, expect, it } from "vitest";
import {
  _withFarmGuardedResponseCache,
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry, generateRscMiddlewareResultHandling } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  routesDir: "app",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1_000_000 },
  deploymentId: "guarded-cache-test",
  debug: false,
};

const GUARD_LINE = "if (middlewareResult.guarded) farmCacheGuard.guarded = true;";

// Middleware that lets a visitor through on an IP allowlist or API key header used to leave an
// API route's or llms.txt's shared cache policy on the response, so a CDN served it to everyone.
// Runs the entry's generated wrapper and middleware step against core's real runner.
function createHandler(runner: ReturnType<typeof createProductionMiddlewareRunner>) {
  const entry = generateRscEntry(context);
  const resultHandling = generateRscMiddlewareResultHandling();
  const start = entry.indexOf("async function handleFarmRequest(request, context) {");
  const end = entry.indexOf("async function resolveFarmRequest(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // The guard is recorded after the middleware's own responses and before anything renders.
  const guardAt = entry.indexOf(GUARD_LINE);
  expect(guardAt).toBeGreaterThan(entry.indexOf(resultHandling));
  expect(guardAt).toBeLessThan(entry.indexOf("request = middlewareResult.request;"));

  return new Function(
    "executeMiddleware",
    "applyProductionMiddlewareHeaders",
    "_withFarmGuardedResponseCache",
    `async function resolveFarmRequest(farmCacheGuard, request, context) {
      const middlewareResult = await executeMiddleware(request, context);
      ${resultHandling}
      ${GUARD_LINE}
      // What an API route or llms.txt answers: a response CDNs may share.
      return new Response("shared", {
        headers: { "cache-control": "public, s-maxage=3600", "cdn-cache-control": "max-age=3600" },
      });
    }
    ${entry.slice(start, end)}
    return handleFarmRequest;`,
  )(
    (request: Request) => runner(request),
    applyProductionMiddlewareHeaders,
    _withFarmGuardedResponseCache,
  ) as (request: Request) => Promise<Response>;
}

describe("generated RSC handler", () => {
  const runner = createProductionMiddlewareRunner({
    config: [
      {
        matcher: ["/api/internal/:path*", "/llms.txt"],
        handler(ctx: any) {
          if (ctx.request.headers.get("x-office-key") !== "k-123") {
            return ctx.text("GUARD-BLOCKED", 403);
          }
        },
      },
      { matcher: "/api/logged/:path*", cache: "public", handler: () => {} },
    ],
    modules: [
      { path: "/api/files", module: { config: { cache: "public" }, middleware: () => {} } },
    ],
  });
  const send = async (pathname: string, headers: Record<string, string> = {}) => {
    const response = await createHandler(runner)(
      new Request(`https://app.test${pathname}`, { headers }),
    );
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      cdn: response.headers.get("cdn-cache-control"),
    };
  };

  it("keeps responses a guard let through out of shared caches", async () => {
    for (const pathname of ["/api/internal/report", "/llms.txt"]) {
      expect({ pathname, ...(await send(pathname, { "x-office-key": "k-123" })) }).toEqual({
        pathname,
        status: 200,
        cache: "private, no-store",
        cdn: null,
      });
    }
  });

  it("sends the guard's own response as written", async () => {
    expect((await send("/api/internal/report")).status).toBe(403);
  });

  it("leaves responses shareable when no middleware or only cache: 'public' middleware matched", async () => {
    for (const pathname of ["/api/open", "/api/logged/a", "/api/files/a"]) {
      expect({ pathname, ...(await send(pathname)) }).toEqual({
        pathname,
        status: 200,
        cache: "public, s-maxage=3600",
        cdn: "max-age=3600",
      });
    }
  });
});
