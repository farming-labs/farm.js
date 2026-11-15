import { describe, expect, it } from "vitest";
import { isFarmAPIPathname } from "@farm.js/core/api/runtime";
import {
  resolveFarmI18nConfig,
  resolveFarmTrailingSlashRedirect,
  stripFarmBasePath,
  stripFarmLocaleFromPathname,
} from "@farm.js/core/internal/production-runtime";
import { applyProductionMiddlewareHeaders } from "@farm.js/core/middleware";
import { matchRoute as matchFarmPageRoute, parseRoutePath } from "../../../../farm/src/utils";
import {
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from "../../../../farm/src/routing/specificity";
import type { EntryContext } from "../types.js";
import { generateClientEntry } from "./client.js";
import { generateRscEntry } from "./rsc.js";

type EntryOptions = Partial<
  Pick<EntryContext, "basePath" | "i18n" | "development" | "trailingSlash">
>;

function entryFor(options: EntryOptions = {}) {
  return generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "routing",
    debug: false,
    ...options,
  });
}

function slice(entry: string, startMarker: string, endMarker: string): string {
  const start = entry.indexOf(startMarker);
  const end = entry.indexOf(endMarker, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return entry.slice(start, end);
}

/** The entry's farmRouteI18n and getFarmRoutePathname(). */
function routePathnameHelper(entry: string): string {
  const start = entry.indexOf("const farmRouteI18n = ");
  const fn = entry.indexOf("function getFarmRoutePathname(pathname)", start);
  expect(fn).toBeGreaterThan(start);
  return entry.slice(start, entry.indexOf("\n}\n", fn) + 2);
}

/** The generated matchRoute(), with the entry's route-path helper and core's real helpers. */
function createMatcher(paths: string[], options: EntryOptions = {}) {
  const entry = entryFor(options);
  return new Function(
    "pages",
    "React",
    "debug",
    "parseRoutePath",
    "matchFarmPageRoute",
    "compareRouteSpecificity",
    "getRoutePatternSpecificity",
    "stripFarmBasePath",
    "stripFarmLocaleFromPathname",
    `${routePathnameHelper(entry)}
${slice(entry, "function filePathToRoute(", "// Each page's parsed rendering directive")}; return matchRoute;`,
  )(
    Object.fromEntries(paths.map((p) => [p, { default: () => p }])),
    {},
    () => {},
    parseRoutePath,
    matchFarmPageRoute,
    compareRouteSpecificity,
    getRoutePatternSpecificity,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
  ) as (pathname: string) => { pattern: string; params: Record<string, string> };
}

it("ranks exact pages before dynamic and catch-all pages independently of file order", () => {
  const match = createMatcher([
    "/users/[[...rest]]/page.tsx",
    "/users/[...slug]/page.tsx",
    "/users/[id]/page.tsx",
    "/users/new/page.tsx",
    "/users/page.tsx",
  ]);
  expect(match("/users/new").pattern).toBe("/users/new/page.tsx");
  expect(match("/users").pattern).toBe("/users/page.tsx");
  expect(match("/users/alice").params).toEqual({ id: "alice" });
  expect(match("/users/a/b").params).toEqual({ slug: "a/b" });
});

it("matches optional catch-alls at their parent and descendant paths", () => {
  const match = createMatcher(["/docs/[[...slug]]/page.tsx"]);
  expect(match("/docs")?.params).toEqual({ slug: "" });
  expect(match("/docs/a/b/")?.params).toEqual({ slug: "a/b" });
  expect(match("/elsewhere")).toBeNull();
});

it("uses shared parameter decoding, route groups, and segment specificity", () => {
  const match = createMatcher([
    "/[category]/settings/page.tsx",
    "/shop/[item]/page.tsx",
    "/(marketing)/about/page.tsx",
    "/docs/[...slug]/page.tsx",
  ]);
  expect(match("/shop/settings").pattern).toBe("/shop/[item]/page.tsx");
  expect(match("/about").pattern).toBe("/(marketing)/about/page.tsx");
  expect(match("/docs/caf%C3%A9/a%2520b").params).toEqual({ slug: "café/a%20b" });
  expect(match("/docs")).toBeNull();
});

it.each([
  "/teams/[id]/users/[id]/page.tsx",
  "/users/[__proto__]/page.tsx",
  "/docs/[...slug]/edit/page.tsx",
])("rejects invalid page route %s during entry initialization", (route) => {
  expect(() => createMatcher([route])).toThrow();
});

const resolveI18n = (
  i18n: Parameters<typeof resolveFarmI18nConfig>[0],
  basePath: string,
  development: boolean,
) =>
  resolveFarmI18nConfig(i18n, {
    root: "/tmp",
    mode: development ? "development" : "production",
    basePath,
  });

// Core's renderers match a page on the request path without the basePath (and, with i18n, the
// locale): app/about/page.tsx answers at /console/about. RSC used to match the path as received,
// so its apps nested pages under app/<basePath>/ and app/[lang]/; those keep their URLs.
describe.each([
  ["development", true],
  ["production", false],
])("RSC pages under a basePath (%s entry)", (_mode, development) => {
  const basePath = { basePath: "/console", development };

  it("answer at their route path below the basePath", () => {
    const match = createMatcher(["/page.tsx", "/about/page.tsx", "/users/[id]/page.tsx"], basePath);
    expect(match("/console").pattern).toBe("/page.tsx");
    expect(match("/console/").pattern).toBe("/page.tsx");
    expect(match("/console/about").pattern).toBe("/about/page.tsx");
    expect(match("/console/about/").pattern).toBe("/about/page.tsx");
    expect(match("/console/users/7").params).toEqual({ id: "7" });
    // The path without the basePath still answers, as in core's renderers.
    expect(match("/about").pattern).toBe("/about/page.tsx");
    expect(match("/console/missing")).toBeNull();
    expect(match("/consoleabout")).toBeNull();
  });

  it("keep pages nested under app/<basePath>/ at their URL", () => {
    const match = createMatcher(
      ["/page.tsx", "/console/page.tsx", "/console/legacy/page.tsx", "/console/[id]/page.tsx"],
      basePath,
    );
    expect(match("/console").pattern).toBe("/console/page.tsx");
    expect(match("/console/legacy").pattern).toBe("/console/legacy/page.tsx");
    expect(match("/console/7")).toMatchObject({
      pattern: "/console/[id]/page.tsx",
      params: { id: "7" },
    });
    expect(match("/").pattern).toBe("/page.tsx");
  });

  it("do not let a dynamic or catch-all folder take the basePath", () => {
    const dynamic = createMatcher(["/page.tsx", "/[slug]/page.tsx"], basePath);
    expect(dynamic("/console").pattern).toBe("/page.tsx");
    expect(dynamic("/console/intro").params).toEqual({ slug: "intro" });

    const catchAll = createMatcher(["/[[...slug]]/page.tsx"], basePath);
    expect(catchAll("/console").params).toEqual({ slug: "" });
    expect(catchAll("/console/guides/start").params).toEqual({ slug: "guides/start" });
  });

  it("serve a page's flight payload at its URL below the basePath", () => {
    const { toFarmPayloadRequest } = new Function(
      "isFarmAPIPathname",
      "farmApiBasePath",
      `${slice(
        entryFor(basePath),
        "// Client navigation addresses a page's RSC payload",
        "// The build's prerender pass",
      )}; return { toFarmPayloadRequest };`,
    )(isFarmAPIPathname, "/api") as { toFarmPayloadRequest: (request: Request) => Request };
    const match = createMatcher(["/page.tsx", "/about/page.tsx"], basePath);
    for (const [payload, pattern] of [
      ["/console/about.rsc", "/about/page.tsx"],
      ["/console/index.rsc", "/page.tsx"],
      ["/console.rsc", "/page.tsx"],
    ]) {
      const request = toFarmPayloadRequest(new Request(`https://farm.test${payload}`));
      expect(request.headers.get("accept"), payload).toBe("text/x-component");
      expect(match(new URL(request.url).pathname).pattern, payload).toBe(pattern);
    }
  });

  it("strip the locale as well, and keep app/<basePath>/[lang]/ pages at their URL", () => {
    const i18n = resolveI18n(
      { locales: ["en", "fr"], defaultLocale: "en", routing: "prefix" },
      "/console",
      development,
    );
    const routePaths = createMatcher(["/page.tsx", "/about/page.tsx"], { ...basePath, i18n });
    expect(routePaths("/console/fr/about").pattern).toBe("/about/page.tsx");
    expect(routePaths("/console/fr").pattern).toBe("/page.tsx");
    expect(routePaths("/console/about").pattern).toBe("/about/page.tsx");

    const nested = createMatcher(["/console/[lang]/page.tsx", "/console/[lang]/blog/page.tsx"], {
      ...basePath,
      i18n,
    });
    expect(nested("/console/fr")).toMatchObject({ params: { lang: "fr" } });
    expect(nested("/console/fr/blog")).toMatchObject({
      pattern: "/console/[lang]/blog/page.tsx",
      params: { lang: "fr" },
    });
  });

  it("set the basePath <Link> applies in the server and browser entries", () => {
    const context = {
      srcDir: "src",
      outDir: "dist",
      actionsEnabled: false,
      serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
      deploymentId: "routing",
      debug: false,
      development,
    };
    expect(entryFor(basePath)).toContain('setFarmBasePath("/console");');
    expect(generateClientEntry({ ...context, basePath: "/console" })).toContain(
      'setFarmBasePath("/console");',
    );
    expect(entryFor({ development })).not.toContain("setFarmBasePath");
    expect(generateClientEntry({ ...context, basePath: "/" })).not.toContain("setFarmBasePath");
  });
});

describe("RSC pages with i18n at the root", () => {
  const i18n = resolveI18n(
    { locales: ["en", "fr"], defaultLocale: "en", routing: "prefix" },
    "/",
    false,
  );

  it("keep app/[lang]/ pages from being taken by the locale's home page", () => {
    // '/fr/blog' strips to '/blog', which app/[lang]/page.tsx would match with lang "blog".
    const match = createMatcher(["/[lang]/page.tsx", "/[lang]/blog/page.tsx"], { i18n });
    expect(match("/fr/blog")).toMatchObject({
      pattern: "/[lang]/blog/page.tsx",
      params: { lang: "fr" },
    });
    expect(match("/fr")).toMatchObject({ pattern: "/[lang]/page.tsx", params: { lang: "fr" } });
  });

  it("match a page at its route path below the locale", () => {
    const match = createMatcher(["/page.tsx", "/about/page.tsx"], { i18n });
    expect(match("/fr/about").pattern).toBe("/about/page.tsx");
    expect(match("/fr").pattern).toBe("/page.tsx");
  });
});

it("matches a root-mounted app's pages on the path as received, with nothing more", () => {
  const entry = entryFor();
  expect(entry).not.toContain("farmPageSpellsRoutePrefix");
  expect(slice(entry, "function matchRoute(pathname)", "function matchFarmPagePath")).not.toContain(
    "getFarmRoutePathname",
  );
  expect(entryFor({ basePath: "/console" })).toContain("farmPageSpellsRoutePrefix");
});

/**
 * The entry's trailing-slash redirect, as the request handler runs it after middleware: the
 * generated block over the entry's own matchRoute() and payload helpers, with core's real helpers.
 */
function createTrailingSlashRedirect(paths: string[], options: EntryOptions = {}) {
  const entry = entryFor(options);
  const start = entry.indexOf("  const trailingSlashLocation = ");
  expect(start).toBeGreaterThan(-1);
  const block = entry.slice(start, entry.indexOf("\n  }\n", start) + 4);
  const { farmPayloadPath, toFarmPayloadRequest, farmPayloadRequests } = new Function(
    "isFarmAPIPathname",
    "farmApiBasePath",
    `${slice(
      entry,
      "// Client navigation addresses a page's RSC payload",
      "// The build's prerender pass",
    )}; return { farmPayloadPath, toFarmPayloadRequest, farmPayloadRequests };`,
  )(isFarmAPIPathname, "/api") as {
    farmPayloadPath: (pathname: string) => string;
    toFarmPayloadRequest: (request: Request) => Request;
    farmPayloadRequests: WeakSet<Request>;
  };
  const redirect = new Function(
    "matchRoute",
    "farmPayloadPath",
    "resolveFarmTrailingSlashRedirect",
    "applyProductionMiddlewareHeaders",
    "url",
    "isFarmPayloadRequest",
    "middlewareHeaders",
    `${block}\nreturn null;`,
  );
  const matchRoute = createMatcher(paths, options);
  // What the client requests: the page URL, or '<page>.rsc' for a navigation's payload.
  return (href: string, middlewareHeaders = new Headers()): Response | null => {
    const request = toFarmPayloadRequest(new Request(new URL(href, "https://farm.test")));
    return redirect(
      matchRoute,
      farmPayloadPath,
      resolveFarmTrailingSlashRedirect,
      applyProductionMiddlewareHeaders,
      new URL(request.url),
      farmPayloadRequests.has(request),
      middlewareHeaders,
    );
  };
}

// Core's servers answer a page at one spelling of its URL and send any other to it with a 308:
// without trailingSlash '/about', with it '/about/'. The root is always '/'.
describe.each([
  ["development", true],
  ["production", false],
])("RSC trailing slashes (%s entry)", (_mode, development) => {
  const pages = ["/page.tsx", "/about/page.tsx", "/console/legacy/page.tsx"];
  const location = (response: Response | null) =>
    response ? [response.status, response.headers.get("location")] : null;

  it("redirect a page's trailing-slash URL to the one without, by default", () => {
    const redirect = createTrailingSlashRedirect(pages, { basePath: "/console", development });
    expect(location(redirect("/console/about/?tab=a&tab=b"))).toEqual([
      308,
      "/console/about?tab=a&tab=b",
    ]);
    expect(location(redirect("/console/"))).toEqual([308, "/console"]);
    expect(location(redirect("/console/legacy/"))).toEqual([308, "/console/legacy"]);
    // A navigation's payload request is sent to the canonical page's payload.
    expect(location(redirect("/console/about/index.rsc?q=1"))).toEqual([
      308,
      "/console/about.rsc?q=1",
    ]);
    for (const canonical of ["/console/about", "/console", "/", "/console/about.rsc"]) {
      expect(redirect(canonical), canonical).toBeNull();
    }
    // No page: the request goes on to the 404.
    expect(redirect("/console/missing/")).toBeNull();
    // Headers middleware set reach the redirect, as in core's servers.
    const headers = new Headers({ "x-middleware": "ran" });
    expect(redirect("/about/", headers)?.headers.get("x-middleware")).toBe("ran");
  });

  it("redirect to the trailing-slash URL with trailingSlash", () => {
    const redirect = createTrailingSlashRedirect(pages, {
      basePath: "/console",
      trailingSlash: true,
      development,
    });
    expect(location(redirect("/console/about?q=1"))).toEqual([308, "/console/about/?q=1"]);
    expect(location(redirect("/console"))).toEqual([308, "/console/"]);
    expect(location(redirect("/console/about.rsc"))).toEqual([308, "/console/about/index.rsc"]);
    expect(location(redirect("/console.rsc"))).toEqual([308, "/console/index.rsc"]);
    for (const canonical of ["/console/about/", "/console/", "/", "/console/about/index.rsc"]) {
      expect(redirect(canonical), canonical).toBeNull();
    }

    const root = createTrailingSlashRedirect(pages, { trailingSlash: true, development });
    expect(location(root("/about"))).toEqual([308, "/about/"]);
    expect(root("/")).toBeNull();
    expect(root("/index.rsc")).toBeNull();
  });

  it("set the trailing-slash preference <Link> applies in the server and browser entries", () => {
    const context = {
      srcDir: "src",
      outDir: "dist",
      basePath: "/",
      actionsEnabled: false,
      serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
      deploymentId: "routing",
      debug: false,
      development,
    };
    expect(entryFor({ trailingSlash: true, development })).toContain(
      "setFarmTrailingSlashPreference(true);",
    );
    expect(generateClientEntry({ ...context, trailingSlash: true })).toContain(
      "setFarmTrailingSlashPreference(true);",
    );
    expect(entryFor({ development })).not.toContain("setFarmTrailingSlashPreference");
    expect(generateClientEntry(context)).not.toContain("setFarmTrailingSlashPreference");
  });
});
