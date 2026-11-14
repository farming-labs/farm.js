import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createFarmDeploymentCookie,
  createFarmDeploymentMismatchResponse,
  getFarmDeploymentMismatch,
} from "@farm.js/core/deployment";
import { _withFarmResponseHeaders } from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/console",
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "release-2",
  debug: false,
};

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

/**
 * The generated outer handler with the real core deployment helpers. `respond` stands in for the
 * page pipeline below it: it receives the page request (a '.rsc' URL becomes a Flight request) and
 * runs the generated page headers, as a rendered page does.
 */
function createHandler(respond: (request: Request) => Response) {
  const entry = generateRscEntry(context);
  return new Function(
    "farmDeploymentId",
    "createFarmDeploymentCookie",
    "getFarmDeploymentMismatch",
    "createFarmDeploymentMismatchResponse",
    "_withFarmResponseHeaders",
    "isFarmAPIPathname",
    "farmApiBasePath",
    "collectFarmStaticPages",
    "respond",
    `${slice(entry, "// Directives a CDN reads in place of Cache-Control", "// Auto-discover all route modules")}
    ${slice(entry, "// Client navigation addresses a page's RSC payload", "async function handleFarmRequestWithRuntime(")}
    async function handleFarmRequestWithRuntime(request) {
      // The page pipeline refuses a request naming another deployment before anything renders.
      const mismatch = getFarmDeploymentMismatch(request, farmDeploymentId);
      if (mismatch) return createFarmDeploymentMismatchResponse(mismatch);
      const response = respond(request);
      if (!response.headers.has('x-farm-page')) return response;
      const headers = new Headers(response.headers);
      applyActionResponseHeaders(headers, request);
      return new Response(response.body, { status: response.status, headers });
    }
    return handler;`,
  )(
    "release-2",
    createFarmDeploymentCookie,
    getFarmDeploymentMismatch,
    createFarmDeploymentMismatchResponse,
    _withFarmResponseHeaders,
    () => false,
    "/api",
    async () => [],
    respond,
  ) as (request: Request) => Promise<Response>;
}

/** A rendered page, with the Cache-Control middleware chose (if any). */
const page =
  (headers: Record<string, string> = {}) =>
  (request: Request) =>
    new Response(
      (request.headers.get("accept") ?? "").includes("text/x-component") ? "0:{}" : "<html>",
      {
        headers: {
          "content-type": (request.headers.get("accept") ?? "").includes("text/x-component")
            ? "text/x-component"
            : "text/html",
          "x-farm-page": "1",
          ...headers,
        },
      },
    );

const COOKIE = "__farm_deployment=release-2; Path=/console; HttpOnly; SameSite=Lax";

describe("the RSC deployment cookie", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sets the cookie on a page document that stays out of shared caches", async () => {
    const response = await createHandler(page())(new Request("http://app.test/console/about"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-farm-deployment-id")).toBe("release-2");
    expect(response.headers.getSetCookie()).toEqual([COOKIE]);

    const secure = await createHandler(page())(new Request("https://app.test/console/about"));
    expect(secure.headers.getSetCookie()).toEqual([`${COOKIE}; Secure`]);
  });

  it.each([
    ["a public Cache-Control", { "cache-control": "public, max-age=60" }],
    ["an s-maxage", { "cache-control": "s-maxage=300, stale-while-revalidate=60" }],
    ["a CDN cache header", { "cache-control": "private", "cdn-cache-control": "max-age=60" }],
    [
      "a Vercel CDN cache header",
      { "cache-control": "no-store", "vercel-cdn-cache-control": "max-age=60" },
    ],
  ])("sends a page with %s without the cookie", async (_label, headers) => {
    const response = await createHandler(page(headers))(
      new Request("https://app.test/console/about"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-farm-deployment-id")).toBe("release-2");
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("keeps the cookie off Flight payloads, mutations, HEAD, and responses that are not pages", async () => {
    const handler = createHandler((request) =>
      new URL(request.url).pathname.startsWith("/api")
        ? Response.json({ ok: true })
        : page()(request),
    );
    for (const request of [
      new Request("http://app.test/console/about", { headers: { accept: "text/x-component" } }),
      new Request("http://app.test/console/about.rsc"),
      new Request("http://app.test/console/about", { method: "HEAD" }),
      new Request("http://app.test/console/about", {
        method: "POST",
        headers: { cookie: "__farm_deployment=release-2" },
      }),
      new Request("http://app.test/api/status"),
    ]) {
      const response = await handler(request);
      expect(response.status, `${request.method} ${request.url}`).toBe(200);
      expect(response.headers.getSetCookie(), `${request.method} ${request.url}`).toEqual([]);
    }
  });

  it("refuses a request naming another deployment without refreshing its cookie", async () => {
    const handler = createHandler(page());
    for (const request of [
      new Request("http://app.test/console/about", {
        headers: { "x-farm-deployment-id": "release-1" },
      }),
      new Request("http://app.test/console/about", {
        method: "POST",
        headers: { cookie: "__farm_deployment=release-1" },
      }),
    ]) {
      const response = await handler(request);
      expect(response.status).toBe(409);
      expect(response.headers.get("x-farm-deployment-id")).toBe("release-2");
      expect(response.headers.getSetCookie()).toEqual([]);
    }
  });

  it("renews a stale cookie when a document loads the current deployment", async () => {
    // A document load reads only the header, so another deployment's cookie does not refuse it.
    const response = await createHandler(page())(
      new Request("http://app.test/console/about", {
        headers: { cookie: "__farm_deployment=release-1" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie()).toEqual([COOKIE]);
  });

  it("writes prerendered pages without the cookie", async () => {
    vi.stubEnv("FARM_RSC_PRERENDER", "1");
    const response = await createHandler(page())(
      new Request("http://localhost/console/static", {
        headers: { "x-nitro-prerender": "/console/static" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-nitro-prerender")).toBe(
      encodeURIComponent("/console/static.rsc"),
    );
    expect(response.headers.getSetCookie()).toEqual([]);
  });
});
