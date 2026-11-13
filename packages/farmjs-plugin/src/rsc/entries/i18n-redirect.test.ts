import { describe, expect, it } from "vitest";
import { isFarmAPIPathname } from "@farm.js/core/api/runtime";
import { _runWithFarmI18nRequest, createFarmI18nRuntime } from "@farm.js/core/i18n/server";
import {
  createFarmLocaleCookie,
  getFarmLocaleVaryHeaders,
  normalizeFarmTrailingSlashPathname,
  resolveFarmI18nConfig,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

/**
 * The generated locale wrapper of an app with i18n under basePath "/console", run with core's
 * runtime, where `/console/about` is a page and `/console/llms.txt` is not.
 */
function localizedRequestRunner(trailingSlash: boolean) {
  const i18n = resolveFarmI18nConfig(
    { locales: ["en", "fr"], defaultLocale: "en" },
    { basePath: "/console" },
  );
  const entry = generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/console",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "i18n-redirect",
    debug: false,
    i18n,
    i18nCatalogs: { en: {}, fr: {} },
    trailingSlash,
  } as EntryContext);
  const start = entry.indexOf("async function runFarmLocalizedRequest(");
  const end = entry.indexOf("\n}\n", entry.indexOf("function applyFarmI18nResponse(", start)) + 3;
  const pages = new Set(["/console/about", "/console/fr/about"]);
  return new Function(
    "farmI18nRuntime",
    "farmRouteI18n",
    "_runWithFarmI18nRequest",
    "getFarmLocaleVaryHeaders",
    "createFarmLocaleCookie",
    "normalizeFarmTrailingSlashPathname",
    "isFarmAPIPathname",
    "farmApiBasePath",
    "farmImagePath",
    "matchRoute",
    "farmPayloadPath",
    `${entry.slice(start, end)}; return runFarmLocalizedRequest;`,
  )(
    createFarmI18nRuntime(i18n, { en: {}, fr: {} }),
    i18n,
    _runWithFarmI18nRequest,
    getFarmLocaleVaryHeaders,
    createFarmLocaleCookie,
    normalizeFarmTrailingSlashPathname,
    isFarmAPIPathname,
    "/api",
    "/_farm/image",
    (pathname: string) => (pages.has(pathname.replace(/\/$/, "")) ? {} : null),
    (pathname: string) => (pathname.endsWith("/") ? pathname + "index.rsc" : pathname + ".rsc"),
  ) as (
    request: Request,
    payloadRequested: boolean,
    render: () => Promise<Response>,
  ) => Promise<Response>;
}

const french = (pathname: string) =>
  new Request(`https://farm.test${pathname}`, { headers: { "accept-language": "fr" } });

describe("RSC locale redirects", () => {
  it("go straight to a page's trailing-slash URL with trailingSlash, as one redirect", async () => {
    const run = localizedRequestRunner(true);
    const render = async () => new Response("page");
    for (const [pathname, payload, location] of [
      ["/console/about/", false, "/console/fr/about/"],
      ["/console/about?tab=1", false, "/console/fr/about/?tab=1"],
      ["/console/about/", true, "/console/fr/about/index.rsc"],
      // Not a page: the trailing-slash rule is not this path's, as in core.
      ["/console/llms.txt", false, "/console/fr/llms.txt"],
    ] as const) {
      const response = await run(french(pathname), payload, render);
      expect(response.status, pathname).toBe(307);
      expect(response.headers.get("location"), pathname).toBe(location);
    }
  });

  it("keep core's target without trailingSlash", async () => {
    const run = localizedRequestRunner(false);
    const response = await run(french("/console/about"), false, async () => new Response("page"));
    expect(response.headers.get("location")).toBe("/console/fr/about");
  });
});
