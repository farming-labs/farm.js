import { describe, expect, it } from "vitest";
import {
  _getRequestReadCount,
  _hasPrivateFarmRequestHeaders,
  _runWithCurrentRequest,
  getCurrentRequest,
  mergeRouteRenderingDirectiveConfig,
  resolveRouteSharedCacheControl,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: true,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
  deploymentId: "release-1",
  debug: false,
  // What the build bakes from each page's source: a "use ssg; 60" directive, and a static page
  // whose own source reads the request.
  pageRenderingDirectives: {
    "/src/app/directive/page.tsx": {
      ssg: true,
      ppr: false,
      revalidate: 60,
      directive: "use ssg; 60",
    },
    "/src/app/reads/page.tsx": { ssg: false, ppr: false, directive: "", requestBound: true },
  },
};

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

type PolicyArgs = {
  pattern: string;
  module: Record<string, unknown>;
  request?: Request;
  middlewareData?: Map<string, unknown>;
  middlewareContext?: Map<string, unknown>;
  readDuringRender?: boolean;
  localeSource?: string;
};

/** The generated getFarmPageCacheControl, run with core's real helpers. */
function createPolicy(ctx: EntryContext) {
  const entry = generateRscEntry(ctx);
  const getFarmPageCacheControl = new Function(
    "mergeRouteRenderingDirectiveConfig",
    "resolveRouteSharedCacheControl",
    "_hasPrivateFarmRequestHeaders",
    "_getRequestReadCount",
    "farmRouteI18n",
    "getLocaleSource",
    `${slice(entry, "const farmPageRenderingDirectives", "async function collectFarmStaticPages(")}
    return getFarmPageCacheControl;`,
  );
  return (args: PolicyArgs) => {
    const request = args.request ?? new Request("https://app.test/page");
    const policy = getFarmPageCacheControl(
      mergeRouteRenderingDirectiveConfig,
      resolveRouteSharedCacheControl,
      _hasPrivateFarmRequestHeaders,
      _getRequestReadCount,
      { cookie: { name: "FARM_LOCALE" }, locales: ["en", "fr"] },
      () => args.localeSource ?? "url",
    );
    return _runWithCurrentRequest(request, () => {
      const readsBefore = _getRequestReadCount(request);
      // A layout or the page calling headers()/cookies()/getCurrentRequest() while it renders.
      if (args.readDuringRender) getCurrentRequest();
      return policy(
        request,
        { pattern: args.pattern, module: args.module },
        readsBefore,
        args.middlewareData ?? new Map(),
        args.middlewareContext ?? new Map(),
      ) as string | null;
    });
  };
}

const policyFor = createPolicy(context);
const isr = { pattern: "/src/app/isr/page.tsx", module: { revalidate: 300 } };

describe("RSC page Cache-Control for static and revalidating pages", () => {
  it("sends core's shared policy for revalidate, a directive and a static page", async () => {
    expect(await policyFor(isr)).toBe("public, s-maxage=300, stale-while-revalidate=300");
    expect(await policyFor({ pattern: "/src/app/directive/page.tsx", module: {} })).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    // A static page this server renders (not prerendered) gets core's 60 second default.
    expect(
      await policyFor({ pattern: "/src/app/static/page.tsx", module: { dynamic: "force-static" } }),
    ).toBe("public, s-maxage=60, stale-while-revalidate=300");
    // Each matches what core's server computes for the same route config.
    for (const [pattern, module] of [
      [isr.pattern, isr.module],
      ["/src/app/directive/page.tsx", {}],
      ["/src/app/static/page.tsx", { dynamic: "force-static" }],
    ] as const) {
      expect(await policyFor({ pattern, module })).toBe(
        resolveRouteSharedCacheControl(
          mergeRouteRenderingDirectiveConfig(
            context.pageRenderingDirectives![pattern] as never,
            module as never,
          ),
        ),
      );
    }
  });

  it("leaves other pages to the default", async () => {
    for (const [pattern, module] of [
      ["/src/app/dynamic/page.tsx", {}],
      ["/src/app/zero/page.tsx", { revalidate: 0 }],
      ["/src/app/forced/page.tsx", { revalidate: 300, dynamic: "force-dynamic" }],
      // Its own source reads the request, so the build keeps it dynamic.
      ["/src/app/reads/page.tsx", { revalidate: 300 }],
    ] as const) {
      expect(await policyFor({ pattern, module }), pattern).toBeNull();
    }
  });

  it("keeps a revalidating page private when this render is one visitor's", async () => {
    const privateCases: Array<[string, PolicyArgs]> = [
      [
        "a session cookie",
        {
          ...isr,
          request: new Request("https://app.test/isr", {
            headers: { cookie: "session=abc; __farm_deployment=release-1" },
          }),
        },
      ],
      [
        "Authorization",
        {
          ...isr,
          request: new Request("https://app.test/isr", { headers: { authorization: "Bearer t" } }),
        },
      ],
      ["middleware request data", { ...isr, middlewareData: new Map([["user", "a"]]) }],
      ["middleware context", { ...isr, middlewareContext: new Map([["tenant", "a"]]) }],
      ["a request read while the page rendered", { ...isr, readDuringRender: true }],
      ["a POST", { ...isr, request: new Request("https://app.test/isr", { method: "POST" }) }],
    ];
    for (const [label, args] of privateCases) {
      expect(await policyFor(args), label).toBe("private, no-store");
    }
  });

  it("shares a page with a request carrying only the deployment cookie", async () => {
    for (const request of [
      new Request("https://app.test/isr", { headers: { cookie: "__farm_deployment=release-1" } }),
      new Request("https://app.test/isr", { method: "HEAD" }),
    ]) {
      expect(await policyFor({ ...isr, request })).toBe(
        "public, s-maxage=300, stale-while-revalidate=300",
      );
    }
  });

  it("shares a page with a lone locale cookie only when the URL names the locale, as core does", async () => {
    const policyForI18n = createPolicy({
      ...context,
      i18n: {
        enabled: true,
        basePath: "/",
        locales: ["en", "fr"],
        defaultLocale: "en",
        routing: "prefix",
      } as never,
    });
    const request = () =>
      new Request("https://app.test/fr/isr", { headers: { cookie: "FARM_LOCALE=fr" } });
    expect(await policyForI18n({ ...isr, request: request(), localeSource: "url" })).toBe(
      "public, s-maxage=300, stale-while-revalidate=300",
    );
    expect(await policyForI18n({ ...isr, request: request(), localeSource: "cookie" })).toBe(
      "private, no-store",
    );
    // Without i18n a locale cookie is any other cookie.
    expect(await policyFor({ ...isr, request: request() })).toBe("private, no-store");
  });

  it("decides once, before the page streams, for its HTML and its Flight payload", () => {
    const entry = generateRscEntry(context);
    const decided = entry.indexOf("const farmPageCacheControl = getFarmPageCacheControl(");
    const rendered = entry.indexOf("const rscStream = renderToReadableStream(payload");
    expect(decided).toBeGreaterThan(-1);
    expect(decided).toBeLessThan(rendered);
    // Reads count from before metadata, the page and its layouts render; middleware's do not.
    const baseline = entry.indexOf("const farmReadsBeforeRender = _getRequestReadCount(request);");
    expect(baseline).toBeGreaterThan(
      entry.indexOf("const middlewareResult = await executeMiddleware"),
    );
    expect(baseline).toBeLessThan(entry.indexOf("await resolveFarmRouteMetadata("));
  });

  it("keeps farm dev pages out of shared caches, as core's dev server does", () => {
    const entry = generateRscEntry({ ...context, development: true });
    expect(entry).not.toContain("getFarmPageCacheControl(");
    expect(entry).not.toContain("resolveRouteSharedCacheControl");
    expect(entry).toContain("applyActionResponseHeaders(responseHeaders, request);");
  });
});
