import { describe, expect, it, vi } from "vitest";
import {
  FARM_MARKDOWN_CONTENT_TYPE,
  applyMarkdownNegotiationHeaders,
  createFarmMarkdownErrorBody,
  createMarkdownMirrorResponse,
  farmRequestWantsMarkdown,
  resolveMarkdownConfig,
} from "@farm.js/core/markdown";
import {
  resolveFarmI18nConfig,
  stripFarmBasePath,
  stripFarmLocaleFromPathname,
} from "@farm.js/core/internal/production-runtime";
import { matchRoute as matchFarmPageRoute, parseRoutePath } from "../../../../farm/src/utils";
import {
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from "../../../../farm/src/routing/specificity";
import type { EntryContext } from "../types.js";
import {
  createProductionMiddlewareRunner,
  applyProductionMiddlewareHeaders,
  type MiddlewareContext,
} from "@farm.js/core/middleware";
import { generateRscEntry } from "./rsc.js";

const context: EntryContext = {
  srcDir: "src",
  outDir: "dist",
  basePath: "/",
  actionsEnabled: false,
  serverActions: { allowedOrigins: [], bodySizeLimit: 1024 * 1024 } as never,
  deploymentId: "markdown-test",
  debug: false,
  markdown: resolveMarkdownConfig(undefined),
};

/** The generated route-pathname helper, or nothing for an entry without one. */
function extractRoutePathname(entry: string): string {
  const start = entry.indexOf("const farmRouteI18n = ");
  if (start === -1) return "";
  const fn = entry.indexOf("function getFarmRoutePathname(pathname)", start);
  return entry.slice(start, entry.indexOf("\n}\n", fn) + 2);
}

/** The entry's generated matchRoute() over these page files, with core's real helpers. */
function createRouteMatcher(entry: string, pageFiles: string[]) {
  const start = entry.indexOf("function filePathToRoute(");
  const end = entry.indexOf("// Each page's parsed rendering directive", start);
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
    `${extractRoutePathname(entry)}\n${entry.slice(start, end)}; return matchRoute;`,
  )(
    Object.fromEntries(pageFiles.map((file) => [file, { default: () => file }])),
    {},
    () => {},
    parseRoutePath,
    matchFarmPageRoute,
    compareRouteSpecificity,
    getRoutePatternSpecificity,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
  ) as (pathname: string) => { pattern: string } | null;
}

/**
 * Runs the generated outer handler with the real core Markdown helpers. `pages` are the request
 * paths matchRoute() matches; each renders a page titled after its path. With `pageFiles`, the
 * entry's own matchRoute() selects among those files, and a page is titled after its file.
 */
function createHandler(
  markdownConfig = resolveMarkdownConfig(undefined),
  options: Partial<Pick<EntryContext, "basePath" | "i18n" | "development">> & {
    pages?: string[];
    pageFiles?: string[];
  } = {},
) {
  const { pages = ["/pricing"], pageFiles, ...entryOptions } = options;
  const entry = generateRscEntry({ ...context, ...entryOptions, markdown: markdownConfig });
  const start = entry.indexOf("async function handleFarmPageOrMarkdown(request, context)");
  const end = entry.indexOf("async function handler(request, context)", start);
  const matchRoute = pageFiles
    ? createRouteMatcher(entry, pageFiles)
    : (pathname: string) => (pages.includes(pathname) ? { pattern: pathname } : null);
  const rendered: Request[] = [];
  const handleFarmRequest = vi.fn(async (request: Request) => {
    rendered.push(request);
    const { pathname } = new URL(request.url);
    const matched = matchRoute(pathname);
    if (!matched) return new Response("Not Found", { status: 404 });
    const title = pathname === "/pricing" ? "Pricing" : `Page ${matched.pattern}`;
    return new Response(
      `<html><head><title>${title}</title></head><body><main><h1>${title}</h1><p>Plans.</p></main></body></html>`,
      { headers: { "content-type": "text/html" } },
    );
  });
  const run = new Function(
    "farmMarkdownConfig",
    "createMarkdownMirrorResponse",
    "applyMarkdownNegotiationHeaders",
    "stripFarmBasePath",
    "stripFarmLocaleFromPathname",
    "matchRoute",
    "handleFarmRequest",
    "farmApiBasePath",
    `${extractRoutePathname(entry)}\n${entry.slice(start, end)}; return handleFarmPageOrMarkdown;`,
  )(
    markdownConfig,
    createMarkdownMirrorResponse,
    applyMarkdownNegotiationHeaders,
    stripFarmBasePath,
    stripFarmLocaleFromPathname,
    matchRoute,
    handleFarmRequest,
    "/api",
  ) as (request: Request, context?: unknown) => Promise<Response>;
  return { run, rendered, handleFarmRequest };
}

describe("RSC Markdown mirrors", () => {
  it.each(["GET", "HEAD"])("serves the actions JSON through the RSC %s wrapper", async (method) => {
    const { run, handleFarmRequest } = createHandler();
    handleFarmRequest.mockImplementation(
      async () =>
        new Response(
          '<main><form method="post"><input name="email"><button>Send</button></form></main>',
          { headers: { "content-type": "text/html" } },
        ),
    );
    for (const suffix of [".md", ""]) {
      const response = await run(
        new Request(`https://farm.test/pricing${suffix}?actions&ref=nav`, {
          method,
          headers: { accept: "text/markdown" },
        }),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
      const body = await response.text();
      expect(method === "HEAD" ? body : JSON.parse(body).actions[0].action).toBe(
        method === "HEAD" ? "" : "/pricing?ref=nav",
      );
      const cached = await run(
        new Request(`https://farm.test/pricing${suffix}?actions&ref=nav`, {
          method,
          headers: { accept: "text/markdown", "if-none-match": response.headers.get("etag")! },
        }),
      );
      expect(cached.status).toBe(304);
      expect(await cached.text()).toBe("");
    }
  });

  it.each(["GET", "HEAD"])(
    "evaluates Markdown preconditions through the RSC %s wrapper",
    async (method) => {
      for (const pathname of ["/pricing.md", "/pricing"]) {
        for (const match of ["*", '"html"']) {
          const { run, handleFarmRequest } = createHandler();
          const response = await run(
            new Request(`https://farm.test${pathname}`, {
              method,
              headers: {
                accept: "text/markdown",
                "if-match": match,
                "if-unmodified-since": "Wed, 21 Oct 2015 07:28:00 GMT",
              },
            }),
          );
          expect(response.status).toBe(match === "*" ? 200 : 412);
          const body = await response.text();
          if (match !== "*" || method === "HEAD") expect(body).toBe("");
          else expect(body).toContain("# Pricing");
          expect(handleFarmRequest).toHaveBeenCalledOnce();
          for (const name of ["if-match", "if-unmodified-since"])
            expect(handleFarmRequest.mock.calls[0][0].headers.has(name)).toBe(false);
        }
      }
    },
  );

  it.each(["GET", "HEAD"])(
    "isolates cache validators and ranges through the RSC %s wrapper",
    async (method) => {
      for (const pathname of ["/pricing.md", "/pricing"]) {
        const { run, handleFarmRequest } = createHandler();
        handleFarmRequest.mockImplementation(async (request) =>
          request.headers.has("range")
            ? new Response("<h1>Part", {
                status: 206,
                headers: { "content-type": "text/html", "content-range": "bytes 0-7/20" },
              })
            : new Response("<h1>Whole page</h1>", { headers: { "content-type": "text/html" } }),
        );
        const response = await run(
          new Request(`https://farm.test${pathname}`, {
            method,
            headers: {
              accept: "text/markdown",
              range: "bytes=0-7",
              "if-range": '"html"',
              "if-none-match": '"html"',
              "if-modified-since": "Wed, 21 Oct 2015 07:28:00 GMT",
            },
          }),
        );
        expect(response.status).toBe(200);
        expect(await response.text()).toBe(
          method === "HEAD" ? "" : "Source: /pricing\n\n# Whole page\n",
        );
        expect(handleFarmRequest).toHaveBeenCalledOnce();
        for (const name of ["if-none-match", "if-modified-since", "range", "if-range"])
          expect(handleFarmRequest.mock.calls[0][0].headers.has(name)).toBe(false);
      }
    },
  );

  it.each(["GET", "HEAD"])(
    "preserves HTML authentication errors through the RSC %s wrapper",
    async (method) => {
      for (const pathname of ["/pricing.md", "/pricing"]) {
        const { run, handleFarmRequest } = createHandler();
        handleFarmRequest.mockResolvedValue(
          new Response("<h1>Sign in</h1><p>Access requires authentication.</p>", {
            status: 401,
            headers: {
              "content-type": "text/html",
              "www-authenticate": 'Bearer realm="farm"',
              "retry-after": "60",
            },
          }),
        );
        const response = await run(
          new Request(`https://farm.test${pathname}?actions`, {
            method,
            headers: { accept: "text/markdown" },
          }),
        );
        expect(response.status).toBe(401);
        expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
        expect(response.headers.get("www-authenticate")).toBe('Bearer realm="farm"');
        expect(response.headers.get("retry-after")).toBe("60");
        expect(await response.text()).toBe(
          method === "HEAD"
            ? ""
            : "Source: /pricing\n\n# Sign in\n\nAccess requires authentication.\n",
        );
        expect(handleFarmRequest).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([204, 205, 304])(
    "retains bodyless HTML %s responses without conversion or retry",
    async (status) => {
      for (const pathname of ["/pricing.md", "/pricing"]) {
        for (const method of ["GET", "HEAD"]) {
          const { run, handleFarmRequest } = createHandler();
          const page = new Response(null, {
            status,
            headers: { "content-type": "text/html", etag: '"page"' },
          });
          handleFarmRequest.mockResolvedValue(page);
          const response = await run(
            new Request(`https://farm.test${pathname}?outline`, {
              method,
              headers: { accept: "text/markdown" },
            }),
          );
          expect(response).toBe(page);
          expect(response.body).toBeNull();
          expect(response.headers.get("etag")).toBe('"page"');
          expect(handleFarmRequest).toHaveBeenCalledOnce();
        }
      }
    },
  );

  it("forwards cancellation through the generated RSC mirror wrapper", async () => {
    const controller = new AbortController();
    const { run, rendered } = createHandler();
    const pending = run(new Request("https://farm.test/pricing.md", { signal: controller.signal }));
    controller.abort("request cancelled");
    await pending;
    expect(rendered[0].signal.aborted).toBe(true);
    expect(rendered[0].signal.reason).toBe("request cancelled");
  });

  it.each(["/pricing.md", "/pricing"])(
    "does not retry rate-limited middleware at %s",
    async (pathname) => {
      const limited = vi.fn(
        () =>
          new Response("Slow down", {
            status: 429,
            headers: { "retry-after": "60", "cache-control": "no-store" },
          }),
      );
      const runner = createProductionMiddlewareRunner({
        modules: [{ path: "/pricing", module: { default: limited } }],
      });
      const { run, handleFarmRequest } = createHandler();
      handleFarmRequest.mockImplementation(async (request: Request) => {
        const result = await runner(request);
        return result.response ?? new Response("Not Found", { status: 404 });
      });
      const response = await run(
        new Request(`https://farm.test${pathname}`, {
          headers: { accept: "text/markdown" },
        }),
      );
      expect(response.status).toBe(429);
      expect(response.headers.get("retry-after")).toBe("60");
      expect(await response.text()).toBe("Slow down");
      expect(limited).toHaveBeenCalledOnce();
      expect(handleFarmRequest).toHaveBeenCalledOnce();
    },
  );

  it("preserves middleware cookies in the published core runtime", async () => {
    const runner = createProductionMiddlewareRunner({
      modules: [
        {
          path: "/pricing",
          module: {
            default(ctx: MiddlewareContext) {
              ctx.cookies.set("session", "renewed", { httpOnly: true });
              ctx.cookies.set("old", "", { maxAge: 0 });
            },
          },
        },
      ],
    });
    for (const pathname of ["/pricing", "/pricing.md"]) {
      const { run, handleFarmRequest } = createHandler(resolveMarkdownConfig({ cache: 300 }));
      handleFarmRequest.mockImplementation(async (request: Request) => {
        const result = await runner(request);
        return applyProductionMiddlewareHeaders(
          new Response("<h1>Pricing</h1>", { headers: { "content-type": "text/html" } }),
          result.headers,
        );
      });
      const response = await run(
        new Request(`https://farm.test${pathname}`, {
          headers: { accept: "text/markdown" },
        }),
      );
      expect(response.headers.getSetCookie()).toEqual([
        "session=renewed; Path=/; HttpOnly",
        "old=; Max-Age=0; Path=/",
      ]);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(handleFarmRequest).toHaveBeenCalledOnce();
    }
  });

  it("serves a page's mirror at .md, rendering the page through the normal request path", async () => {
    const { run, rendered } = createHandler();
    const response = await run(new Request("https://farm.test/pricing.md"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await response.text()).toContain("# Pricing");
    expect(
      rendered.map((request) => [new URL(request.url).pathname, request.headers.get("accept")]),
    ).toEqual([["/pricing", "text/html"]]);
  });

  it("negotiates Accept: text/markdown and supports the partial views", async () => {
    const { run } = createHandler();
    const negotiated = await run(
      new Request("https://farm.test/pricing", { headers: { accept: "text/markdown" } }),
    );
    expect(negotiated.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(negotiated.headers.get("vary")).toContain("Accept");
    const outline = await run(new Request("https://farm.test/pricing.md?outline"));
    expect(await outline.text()).toContain("# Outline of /pricing.md");
  });

  it("advertises the mirror on HTML pages and leaves other responses alone", async () => {
    const { run } = createHandler();
    const page = await run(new Request("https://farm.test/pricing"));
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(page.headers.get("link")).toBe('</pricing.md>; rel="alternate"; type="text/markdown"');
    const missing = await run(new Request("https://farm.test/nope"));
    expect(missing.status).toBe(404);
    expect(missing.headers.get("link")).toBeNull();
  });

  it("does nothing when md is turned off", async () => {
    const { run, rendered } = createHandler(resolveMarkdownConfig(false));
    const response = await run(new Request("https://farm.test/pricing.md"));
    expect(response.status).toBe(404);
    expect(rendered.map((request) => new URL(request.url).pathname)).toEqual(["/pricing.md"]);
    const page = await run(new Request("https://farm.test/pricing"));
    expect(page.headers.get("link")).toBeNull();
  });

  it("answers a missing page in Markdown when the request wants Markdown", () => {
    const entry = generateRscEntry(context);
    expect(entry).toContain(
      "farmRequestWantsMarkdown(url.pathname, request.headers.get('accept'))",
    );
    expect(entry).toContain("createFarmMarkdownErrorBody(404, url.pathname)");
    expect(entry).toContain("'X-Farm-Markdown-Error': '404'");
    // The generated module imports the helpers it uses from core.
    for (const name of [
      "createMarkdownMirrorResponse",
      "applyMarkdownNegotiationHeaders",
      "farmRequestWantsMarkdown",
      "createFarmMarkdownErrorBody",
      "FARM_MARKDOWN_CONTENT_TYPE",
    ]) {
      expect(entry).toMatch(
        new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from '@farm.js/core/markdown'`),
      );
    }
    void [FARM_MARKDOWN_CONTENT_TYPE, createFarmMarkdownErrorBody, farmRequestWantsMarkdown];
  });
});

// Under a basePath (and locale), pages answer below the prefix: app/about/page.tsx, or a page
// nested under app/<basePath>/ (app/<basePath>/[lang]/), answers at /console/about. Markdown
// reads the route path core's servers read: <prefix>/index.md is that prefix's home page, which is
// what every advertised URL names, and md.expose lists route paths.
describe.each([
  ["development", true],
  ["production", false],
])("RSC Markdown under a basePath and locale (%s entry)", (_mode, development) => {
  const resolveI18n = (i18n: Parameters<typeof resolveFarmI18nConfig>[0]) =>
    resolveFarmI18nConfig(i18n, {
      root: "/tmp",
      mode: development ? "development" : "production",
      basePath: "/console",
    });
  const basePath = {
    basePath: "/console",
    i18n: resolveI18n(false),
    development,
    pages: ["/console", "/console/about"],
  };
  const localized = {
    basePath: "/console",
    i18n: resolveI18n({ locales: ["en", "fr"], defaultLocale: "en", routing: "prefix" }),
    development,
    pages: ["/console/fr", "/console/fr/about"],
  };

  it("strips the prefix with core's helpers", () => {
    expect(generateRscEntry({ ...context, ...basePath })).toContain(
      "import { stripFarmBasePath, stripFarmLocaleFromPathname } from '@farm.js/core/internal/production-runtime';",
    );
  });

  it("finds the page the render selects: at its route path, or nested under the prefix", async () => {
    for (const options of [
      { ...basePath, pageFiles: ["/page.tsx", "/about/page.tsx", "/console/legacy/page.tsx"] },
      {
        ...localized,
        pageFiles: ["/page.tsx", "/about/page.tsx", "/console/[lang]/legacy/page.tsx"],
      },
    ]) {
      const prefix = options.i18n.enabled ? "/console/fr" : "/console";
      const { run } = createHandler(resolveMarkdownConfig(undefined), options);
      for (const [pathname, title] of [
        [`${prefix}/index.md`, "# Page /page.tsx"],
        [`${prefix}/about.md`, "# Page /about/page.tsx"],
        [`${prefix}/legacy.md`, `# Page ${options.pageFiles[2]}`],
      ]) {
        const response = await run(new Request(`https://farm.test${pathname}`));
        expect(response.status, pathname).toBe(200);
        expect(response.headers.get("content-location"), pathname).toBe(pathname);
        expect(await response.text(), pathname).toContain(title);
      }
      const page = await run(new Request(`https://farm.test${prefix}/about`));
      expect(page.headers.get("link")).toBe(
        `<${prefix}/about.md>; rel="alternate"; type="text/markdown"`,
      );
      const missing = await run(new Request(`https://farm.test${prefix}/missing.md`));
      expect(missing.status).toBe(404);
    }
  });

  it("serves <basePath>/index.md as the home page and advertises it", async () => {
    const { run, rendered } = createHandler(resolveMarkdownConfig(undefined), basePath);
    const markdown = await run(new Request("https://farm.test/console/index.md"));
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-location")).toBe("/console/index.md");
    expect(await markdown.text()).toContain("# Page /console");
    expect(rendered.map((request) => new URL(request.url).pathname)).toEqual(["/console"]);

    const page = await run(new Request("https://farm.test/console"));
    expect(page.headers.get("link")).toBe(
      '</console/index.md>; rel="alternate"; type="text/markdown"',
    );
    // <basePath>.md still serves the page, under its canonical URL.
    const legacy = await run(new Request("https://farm.test/console.md"));
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("content-location")).toBe("/console/index.md");

    const about = await run(new Request("https://farm.test/console/about.md"));
    expect(about.status).toBe(200);
    expect(about.headers.get("content-location")).toBe("/console/about.md");
  });

  it("matches md.expose against route paths under a basePath", async () => {
    const { run } = createHandler(resolveMarkdownConfig({ expose: ["/", "/about"] }), basePath);
    for (const [pathname, location] of [
      ["/console/about.md", "/console/about.md"],
      ["/console/index.md", "/console/index.md"],
    ]) {
      const response = await run(new Request(`https://farm.test${pathname}`));
      expect(response.status, pathname).toBe(200);
      expect(response.headers.get("content-location")).toBe(location);
    }
    const page = await run(new Request("https://farm.test/console/about"));
    expect(page.headers.get("link")).toBe(
      '</console/about.md>; rel="alternate"; type="text/markdown"',
    );
  });

  it("serves <basePath>/<locale>/index.md as the localized home page and advertises it", async () => {
    const { run, rendered } = createHandler(resolveMarkdownConfig(undefined), localized);
    const markdown = await run(new Request("https://farm.test/console/fr/index.md"));
    expect(markdown.status).toBe(200);
    expect(markdown.headers.get("content-location")).toBe("/console/fr/index.md");
    expect(await markdown.text()).toContain("# Page /console/fr");
    expect(rendered.map((request) => new URL(request.url).pathname)).toEqual(["/console/fr"]);

    const page = await run(new Request("https://farm.test/console/fr"));
    expect(page.headers.get("link")).toBe(
      '</console/fr/index.md>; rel="alternate"; type="text/markdown"',
    );
  });

  it("matches md.expose against locale-stripped route paths", async () => {
    const { run } = createHandler(resolveMarkdownConfig({ expose: ["/about"] }), localized);
    const response = await run(new Request("https://farm.test/console/fr/about.md"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-location")).toBe("/console/fr/about.md");
    // The home page is not in the list.
    const home = await run(new Request("https://farm.test/console/fr/index.md"));
    expect(home.status).toBe(404);
  });
});
