// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { generateRuntimePathMatcherSource } from "../nitro/universal-build";

type Route = { pattern: string; id: number };
type Match = { route: Route; params: Record<string, string> } | null;
const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
const emit = (raw: string): string => new Function(`return \`${raw}\`;`)();

function runtime(pageRoutes: readonly Route[]) {
  const tableStart = source.indexOf("const exactPageRoutes = new Map();");
  const tableEnd = source.indexOf("// Layout routes bundled", tableStart);
  const selectStart = source.indexOf("function matchPageRoute(pathname) {");
  const selectEnd = source.indexOf("\n}", selectStart) + 2;
  expect(tableStart).toBeGreaterThan(-1);
  expect(tableEnd).toBeGreaterThan(tableStart);
  expect(selectStart).toBeGreaterThan(tableEnd);
  const matcher = generateRuntimePathMatcherSource()
    .replace(
      "function splitRuntimePath(pathname) {",
      "function splitRuntimePath(pathname) { splits++;",
    )
    .replace(
      "function decodeRouteSegment(segment) {",
      "function decodeRouteSegment(segment) { decodes++;",
    )
    .replace(
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) {",
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) { genericCalls++;",
    )
    .replaceAll("segment.match(", "matchSegment(segment, ");
  return new Function(
    "pageRoutes",
    `
    let splits = 0, decodes = 0, regexCalls = 0, genericCalls = 0;
    function matchSegment(segment, pattern) { regexCalls++; return segment.match(pattern); }
    ${matcher}
    ${emit(source.slice(tableStart, tableEnd))}
    ${emit(source.slice(selectStart, selectEnd))}
    const previousPatternRoutes = pageRoutes.filter(route => /[\\[\\]*:]/.test(route.pattern));
    function previous(pathname) {
      const exactRoute = exactPageRoutes.get(normalizeRuntimePath(pathname));
      if (exactRoute) return { route: exactRoute, params: {} };
      for (const route of previousPatternRoutes) {
        const params = matchRuntimePathPattern(route.pattern, pathname);
        if (params !== null) return { route, params };
      }
      return null;
    }
    return {
      select: matchPageRoute, previous,
      capture: params => Object.getOwnPropertyDescriptor(params, farmCatchAllParamSegments),
      counts: () => ({ splits, decodes }),
      matchingWork: () => ({ regexCalls, genericCalls }),
      reset: () => { splits = 0; decodes = 0; regexCalls = 0; genericCalls = 0; }
    };
  `,
  )(pageRoutes) as {
    select(pathname: string): Match;
    previous(pathname: string): Match;
    capture(params: Record<string, string>): PropertyDescriptor | undefined;
    counts(): { splits: number; decodes: number };
    matchingWork(): { regexCalls: number; genericCalls: number };
    reset(): void;
  };
}

const routes = (patterns: string[]) => patterns.map((pattern, id) => ({ pattern, id }));
const patterns = [
  "/",
  "/users/settings",
  "/users/[id]",
  "/docs/[[...slug]]",
  "/required/[...slug]",
  "/named/:id",
  "/named-rest/:rest*/end",
  "/stars/*tail?/end",
  "/wild/*/end",
  "/a%20b/[id]",
  "/café/[id]",
  "/[section]/last",
];

describe("production page route input preparation", () => {
  it.each([
    "/",
    "/users/settings",
    "/users/settings/",
    "/users/42",
    "/users/%2541BC",
    "/users/%ZZ",
    "/users/a%2Fb",
    "/docs",
    "/docs/a%252Fb/leaf",
    "/docs/%ZZ",
    "/required",
    "/required/a/b",
    "/named/a%20b",
    "/named-rest/end",
    "/named-rest/a/b/end",
    "/stars/end",
    "/wild/a%2Fb/%ZZ/end",
    "/a%2520b/value",
    "/caf%C3%A9/value",
    "/other/last",
    "/missing/a/b",
    "/docs//a///",
  ])("preserves route identity, params and hidden catch-all captures for %s", (pathname) => {
    const r = runtime(routes(patterns));
    const expected = r.previous(pathname);
    const selected = r.select(pathname);
    expect(selected).toEqual(expected);
    if (selected && expected) {
      expect(selected.route).toBe(expected.route);
      expect(r.capture(selected.params)).toEqual(r.capture(expected.params));
    }
  });

  it.each(["/route99/a%252Fb", "/missing/value"])(
    "splits and decodes each request once across 100 candidates: %s",
    (pathname) => {
      const r = runtime(routes(Array.from({ length: 100 }, (_, i) => `/route${i}/[id]`)));
      const expected = r.previous(pathname);
      r.reset();
      expect(r.select(pathname)).toEqual(expected);
      expect(r.counts()).toEqual({ splits: 1, decodes: 2 });
    },
  );

  it("prepares only pattern routes once without parsing static requests", () => {
    const r = runtime(routes(["/known", "/users/[id]", "/docs/[[...slug]]"]));
    expect(r.counts()).toEqual({ splits: 2, decodes: 0 });
    r.reset();
    expect(r.select("/known/")?.route.pattern).toBe("/known");
    expect(r.counts()).toEqual({ splits: 0, decodes: 0 });
  });

  it("does not prepare request parts for empty or static-only misses", () => {
    for (const patterns of [[], ["/known"]]) {
      const r = runtime(routes(patterns));
      expect(r.select("/missing")).toBeNull();
      expect(r.counts()).toEqual({ splits: 0, decodes: 0 });
    }
  });

  it("preserves the first matching pattern and does not mutate shared route descriptors", () => {
    const input = Object.freeze(
      routes(["/[group]/[id]", "/users/[id]"]).map((route) => Object.freeze(route)),
    );
    const r = runtime(input);
    expect(r.select("/users/one")?.route).toBe(input[0]);
    const first = r.select("/users/one")!;
    first.params.id = "changed";
    expect(r.select("/users/two")?.params).toEqual({ group: "users", id: "two" });
    expect(r.select("/missing")).toBeNull();
    expect(r.select("/users/one")?.params.id).toBe("one");
  });

  it.each(["/route99/a%252Fb", "/missing/value", "/route99", "/route99/one/two"])(
    "does not re-parse fixed-length patterns or create backtracking state for %s",
    (pathname) => {
      const r = runtime(routes(Array.from({ length: 100 }, (_, i) => `/route${i}/[id]`)));
      const expected = r.previous(pathname);
      r.reset();
      expect(r.select(pathname)).toEqual(expected);
      expect(r.matchingWork()).toEqual({ regexCalls: 0, genericCalls: 0 });
    },
  );

  it.each([
    "/docs/[[...slug]]",
    "/docs/[...slug]",
    "/docs/:rest*/end",
    "/docs/*tail?/end",
    "/docs/*tail/end",
    "/docs/*/end",
    "/docs/a*b/[id]",
    "/docs/[...]/[id]",
    "/docs/[[...]]/[id]",
  ])("retains the complete matcher for unsupported preparation: %s", (pattern) => {
    const r = runtime(routes([pattern]));
    for (const pathname of ["/docs", "/docs/end", "/docs/a%2Fb/%ZZ/end"]) {
      const expected = r.previous(pathname);
      r.reset();
      const selected = r.select(pathname);
      expect(selected).toEqual(expected);
      expect(r.matchingWork().genericCalls).toBe(1);
      if (selected && expected)
        expect(r.capture(selected.params)).toEqual(r.capture(expected.params));
    }
  });

  it("preserves generic matching semantics across fixed-length segment combinations", () => {
    const segments = [
      "literal",
      "[id]",
      ":id",
      "[constructor]",
      "[__proto__]",
      "[[id]]",
      "[]",
      "a:b",
      "[unterminated",
      "café",
      "a%2Fb",
      "[a\nb]",
    ];
    const paths = [
      "/literal/value",
      "/literal/value/",
      "/literal//value",
      "/%6Citeral/a%252Fb",
      "/%ZZ/%E0%A4",
      "/caf%C3%A9/a%252Fb",
      "/[]/[a%0Ab]",
      "/a:b/[[id]]",
      "/a/b/c",
      "/a",
      "/",
    ];
    for (const first of segments) {
      for (const second of segments) {
        const r = runtime(routes([`/${first}/${second}`]));
        for (const pathname of paths) {
          const expected = r.previous(pathname);
          const selected = r.select(pathname);
          expect(selected, `${first}/${second} against ${pathname}`).toEqual(expected);
          if (selected && expected)
            expect(r.capture(selected.params)).toEqual(r.capture(expected.params));
        }
      }
    }
  });

  it("keeps params and hidden capture objects fresh for every fixed-length match", () => {
    const r = runtime(routes(["/[id]/:id"]));
    const first = r.select("/one/two")!;
    const second = r.select("/one/two")!;
    expect(first.params).toEqual({ id: "two" });
    expect(first.params).not.toBe(second.params);
    expect(r.capture(first.params)).toEqual({
      value: {},
      writable: false,
      enumerable: false,
      configurable: false,
    });
    expect(r.capture(first.params)!.value).not.toBe(r.capture(second.params)!.value);
    r.capture(first.params)!.value.id = ["changed"];
    first.params.id = "changed";
    expect(second.params).toEqual({ id: "two" });
    expect(r.capture(second.params)!.value).toEqual({});
  });

  it("preserves first-match order across prepared and fallback routes", () => {
    for (const patterns of [
      ["/docs/[[...parts]]", "/docs/[id]"],
      ["/docs/[id]", "/docs/[[...parts]]"],
      ["/docs/:parts*/end", "/docs/[id]/end"],
      ["/docs/[id]/end", "/docs/:parts*/end"],
    ]) {
      const input = routes(patterns);
      const r = runtime(input);
      const pathname = patterns[0].endsWith("/end") ? "/docs/a%2Fb/end" : "/docs/a%2Fb";
      const selected = r.select(pathname)!;
      const expected = r.previous(pathname)!;
      expect(selected.route).toBe(input[0]);
      expect(selected).toEqual(expected);
      expect(r.capture(selected.params)).toEqual(r.capture(expected.params));
    }
  });
});
