// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { collectFarmLlmsTxtPages } from "../llms-txt";
import {
  createMarkdownMirrorResponse,
  matchesFarmMarkdownRoutePattern,
  resolveMarkdownConfig,
  resolveMarkdownMirrorTarget,
} from "../markdown";

function countRegExp<T>(read: () => T): { value: T; constructions: number } {
  let constructions = 0;
  vi.stubGlobal(
    "RegExp",
    new Proxy(RegExp, {
      construct(target, args, newTarget) {
        constructions++;
        return Reflect.construct(target, args, newTarget);
      },
    }),
  );
  try {
    return { value: read(), constructions };
  } finally {
    vi.unstubAllGlobals();
  }
}

// The pre-optimization matcher is a correctness control, including malformed bracket literals.
function legacyMatch(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  let source = "";
  pattern.split("/").forEach((segment, index) => {
    if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) {
      source += "(?:/.*)?";
      return;
    }
    const prefix = index === 0 ? "" : "/";
    if (/^\[\.\.\.[^\]]+\]$/.test(segment)) source += `${prefix}.*`;
    else if (/^\[[^\]]+\]$/.test(segment)) source += `${prefix}[^/]+`;
    else source += prefix + segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  });
  return new RegExp(`^${source}$`).test(pathname);
}

describe("Markdown literal-route matching work", () => {
  const misses = Array.from({ length: 100 }, (_, index) => `/other-${index}`);

  it("does not compile patterns for literal misses or a late literal match", () => {
    const config = resolveMarkdownConfig({
      expose: [...misses, { route: "/target", title: "Target", cache: 60 }],
    });
    const miss = countRegExp(() => resolveMarkdownMirrorTarget(config, "/missing.md"));
    expect(miss.value).toBeNull();
    expect(miss.constructions).toBe(0);
    const hit = countRegExp(() => resolveMarkdownMirrorTarget(config, "/target.md"));
    expect(hit.value).toEqual({
      pathname: "/target",
      route: config.expose !== true ? config.expose[100] : null,
    });
    expect(hit.constructions).toBe(0);
  });

  it("keeps default and exact matches free of compilation", () => {
    for (const config of [
      resolveMarkdownConfig(true),
      resolveMarkdownConfig({ expose: ["/target"] }),
    ]) {
      const result = countRegExp(() => resolveMarkdownMirrorTarget(config, "/target.md"));
      expect(result.value?.pathname).toBe("/target");
      expect(result.constructions).toBe(0);
    }
  });

  it("preserves dynamic matching and first matching route options", () => {
    const config = resolveMarkdownConfig({
      expose: [
        ...misses,
        { route: "/docs/[[...slug]]", title: "First", cache: 60 },
        { route: "/docs/install", title: "Later", cache: false },
      ],
    });
    const result = countRegExp(() => resolveMarkdownMirrorTarget(config, "/docs/install.md"));
    expect(result.value).toEqual({
      pathname: "/docs/install",
      route: { route: "/docs/[[...slug]]", title: "First", cache: 60 },
    });
    expect(result.constructions).toBe(1);
    expect(resolveMarkdownMirrorTarget(config, "/docs.md")?.route?.title).toBe("First");
  });

  it("retains the old result across literal, dynamic, escaped, and malformed patterns", () => {
    const segments = [
      "name",
      "name.ext",
      "a+b",
      "literal*",
      "(group)",
      "a?b",
      "$end",
      "a|b",
      "{word}",
      "x]",
      "x[",
      "[slug]",
      "[...slug]",
      "[[...slug]]",
      "%5Bx%5D",
      "café",
      "\\",
      "\n",
      "\r",
      "\u2028",
      "\u2029",
      "",
    ];
    const patterns = [
      "",
      "/",
      ...["", "/", "/docs/"].flatMap((prefix) => segments.map((segment) => prefix + segment)),
    ];
    const paths = [
      ...patterns,
      ...patterns.flatMap((value) => [`${value}/child`, `${value}/`, `${value}\n`, `${value}\r\n`]),
    ];
    for (const pattern of patterns) {
      for (const pathname of paths) {
        expect(
          matchesFarmMarkdownRoutePattern(pattern, pathname),
          JSON.stringify([pattern, pathname]),
        ).toBe(legacyMatch(pattern, pathname));
      }
    }
  });

  it("keeps llms.txt inclusion, exclusions, and mirror links without compiling literal lists", () => {
    const markdown = resolveMarkdownConfig({ expose: [...misses, "/docs/install"] });
    const result = countRegExp(() =>
      collectFarmLlmsTxtPages(
        [
          { pattern: "/private" },
          { pattern: "/docs/install" },
          { pattern: "/pricing" },
          { pattern: "/docs/[slug]" },
        ],
        {
          origin: "https://farm.test",
          basePath: "/app",
          markdown,
          include: [...misses, "/private", "/docs/install", "/pricing"],
          exclude: [...misses, "/private"],
        },
      ),
    );
    expect(result.value.map(({ path, url }) => ({ path, url }))).toEqual([
      { path: "/docs/install", url: "https://farm.test/app/docs/install.md" },
      { path: "/pricing", url: "https://farm.test/app/pricing" },
    ]);
    expect(result.constructions).toBe(0);
  });

  it("does not render an unexposed route and retains options on a later match", async () => {
    const config = resolveMarkdownConfig({
      expose: [...misses, { route: "/target", title: "Target title", cache: 60 }],
    });
    const renderPage = vi.fn(
      () => new Response("<main><p>Body.</p></main>", { headers: { "content-type": "text/html" } }),
    );
    const missing = await createMarkdownMirrorResponse({
      request: new Request("https://farm.test/private.md"),
      config,
      renderPage,
    });
    expect(missing).toBeNull();
    expect(renderPage).not.toHaveBeenCalled();
    for (const suffix of [".md", ""]) {
      const response = await createMarkdownMirrorResponse({
        request: new Request(`https://farm.test/target${suffix}`, {
          headers: { accept: "text/markdown" },
        }),
        config,
        renderPage,
      });
      expect(response?.status).toBe(200);
      expect(response!.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
      expect(await response!.text()).toBe("# Target title\n\nSource: /target\n\nBody.\n");
    }
    expect(renderPage).toHaveBeenCalledTimes(2);
  });
});
