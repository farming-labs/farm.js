import { describe, expect, it } from "vitest";
import {
  buildFarmRoutePath,
  createFarmRouter,
  isFarmRouteActive,
  matchFarmRoute,
  type FarmRouterMatch,
} from "../router";
import {
  assertBrowserStableRoutePath,
  assertTerminalCatchAll,
  assertUniqueRouteParameters,
  compareRouteSpecificity,
  getRoutePatternShape,
  getRoutePatternSpecificity,
  getRouteSpecificityKey,
  type RoutePatternSyntax,
  type RouteSegmentSpecificity,
} from "../routing/specificity";
import { normalizeRoutePattern, parseRoutePattern } from "../routing/matcher";
import * as reference from "./fixtures/reference-router";

// The router compiles each pattern in one pass and sorts by a specificity key. Every result
// must equal the implementation before it (fixtures/reference-router.ts): the same route,
// params, pathname and order, and the same error for an invalid or ambiguous table.

function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  return { next, pick };
}

const STATIC_SEGMENTS = [
  "docs",
  "users",
  "settings",
  "a",
  "b",
  "%61",
  "caf%C3%A9",
  "café",
  "hello%20farm",
  "hello farm",
  "x.y",
  ".well-known",
  "~tilde",
  "a+b",
  "@modal",
  "%ZZ",
  "%E0%A4%A",
  "[not.valid]",
  "[a%2Fb]",
  "(",
  ")",
  "settings",
];
const UNSTABLE_SEGMENTS = [".", "..", "%2e", "%2E%2E", "a%2Fb", "a%5Cb", "a%0Ab", "tab\tbed"];
const PARAMETER_NAMES = ["id", "slug", "team", "rest", "a", "$x", "-y", "id"];
const RESERVED_NAMES = ["constructor", "__proto__", "prototype"];
const GROUPS = ["(marketing)", "(app)", "()"];

function randomSegment(random: ReturnType<typeof createRandom>, invalid: boolean): string {
  const roll = random.next();
  const name =
    invalid && random.next() < 0.05 ? random.pick(RESERVED_NAMES) : random.pick(PARAMETER_NAMES);
  if (invalid && roll < 0.04) return random.pick(UNSTABLE_SEGMENTS);
  if (roll < 0.45) return random.pick(STATIC_SEGMENTS);
  if (roll < 0.55) return random.pick(GROUPS);
  if (roll < 0.68) return `[${name}]`;
  if (roll < 0.72) return `:${name}`;
  if (roll < 0.8) return `[...${name}]`;
  if (roll < 0.83) return `*${name}`;
  if (roll < 0.9) return `[[...${name}]]`;
  if (roll < 0.93) return `*${name}?`;
  return `${random.pick(STATIC_SEGMENTS)}-${Math.floor(random.next() * 4)}`;
}

function randomPattern(random: ReturnType<typeof createRandom>, invalid: boolean): string {
  const length = Math.floor(random.next() * 5);
  const segments = Array.from({ length }, () => randomSegment(random, invalid));
  if (!invalid) {
    // Keep valid tables mostly valid: parameters unique and catch-alls last.
    const seen = new Set<string>();
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]!;
      const name = /^(?:\[\[\.\.\.|\[\.\.\.|\[|:|\*)([A-Za-z0-9_$-]+)/.exec(segment)?.[1];
      if (name && seen.has(name)) segments[index] = `[${name}${index}]`;
      if (name) seen.add(name);
    }
    const catchAll = segments.findIndex((segment) => /^(?:\[\[?\.\.\.|\*)/.test(segment));
    if (catchAll >= 0) segments.length = catchAll + 1;
  }
  const roll = random.next();
  const path = segments.join("/");
  if (invalid && roll < 0.03) return `/${path}\\x`;
  if (roll < 0.06) return path;
  if (roll < 0.09) return `/${path}/`;
  if (roll < 0.12) return `//${path.replace("/", "//")}`;
  return `/${path}`;
}

const PATH_SEGMENTS = [
  "docs",
  "users",
  "settings",
  "a",
  "%61",
  "b",
  "café",
  "caf%C3%A9",
  "hello%20farm",
  "hello farm",
  "x.y",
  "%ZZ",
  "%E0%A4%A",
  "%5Bnot.valid%5D",
  "[not.valid]",
  "%2F",
  "a%2Fb",
  "@modal",
  "(marketing)",
  "settings-1",
  "docs-2",
  "42",
  "~tilde",
  "a+b",
];

function pathsFor(patterns: string[], random: ReturnType<typeof createRandom>): string[] {
  const paths = new Set(["/", "", "/docs", "/docs/", "//docs//a", "/docs?x=1#h", "/a/b/c/d/e"]);
  for (const pattern of patterns) {
    const filled = pattern
      .split("/")
      .filter((segment) => !(segment.startsWith("(") && segment.endsWith(")")))
      .flatMap((segment) => {
        if (/^(?:\[\[\.\.\.|\*.*\?$)/.test(segment)) {
          return Array.from({ length: Math.floor(random.next() * 3) }, () =>
            random.pick(PATH_SEGMENTS),
          );
        }
        if (/^(?:\[\.\.\.|\*)/.test(segment)) {
          return Array.from({ length: 1 + Math.floor(random.next() * 2) }, () =>
            random.pick(PATH_SEGMENTS),
          );
        }
        if (/^(?:\[[A-Za-z0-9_$-]+\]|:)/.test(segment)) return [random.pick(PATH_SEGMENTS)];
        return [segment];
      });
    paths.add(`/${filled.join("/")}`);
    paths.add(`/${filled.join("/")}/`);
  }
  for (let index = 0; index < 12; index++) {
    const length = Math.floor(random.next() * 4);
    paths.add(`/${Array.from({ length }, () => random.pick(PATH_SEGMENTS)).join("/")}`);
  }
  return [...paths];
}

type Outcome<T> = { value: T } | { error: { name: string; message: string } };

function outcome<T>(run: () => T): Outcome<T> {
  try {
    return { value: run() };
  } catch (error) {
    return {
      error: { name: (error as Error).name, message: (error as Error).message },
    };
  }
}

function describeMatch(match: FarmRouterMatch<unknown> | null) {
  return match
    ? {
        path: match.route.path,
        meta: match.route.meta,
        pathname: match.pathname,
        params: match.params,
      }
    : null;
}

function expectSameRouter(inputs: Array<string | { path: string; meta: number }>, paths: string[]) {
  const actual = outcome(() => createFarmRouter(inputs));
  const expected = outcome(() => reference.createReferenceRouter(inputs));
  if ("error" in expected) {
    expect(actual, JSON.stringify(inputs)).toEqual(expected);
    return false;
  }
  if (!("value" in actual))
    throw new Error(`Unexpected ${JSON.stringify(actual)} for ${JSON.stringify(inputs)}`);
  expect(actual.value.routes).toEqual(expected.value.routes);
  const matches = (router: { match: (pathname: string) => FarmRouterMatch<unknown> | null }) =>
    paths.map((pathname) => [pathname, describeMatch(router.match(pathname))]);
  expect(matches(actual.value), JSON.stringify(inputs).slice(0, 500)).toEqual(
    matches(expected.value),
  );
  return true;
}

function realisticTable(count: number) {
  const routes: string[] = ["/", "/docs/[[...slug]]"];
  for (let index = 0; routes.length < count; index++) {
    const bucket = index % 20;
    if (bucket < 12) routes.push(`/docs/section-${index % 17}/page-${index}`);
    else if (bucket < 15) routes.push(`/(content)/guides/page-${index}`);
    else if (bucket === 15) routes.push(`/(app)/area-${index}/[id]`);
    else if (bucket === 16) routes.push(`/(app)/area-${index}/[id]/settings`);
    else if (bucket === 17) routes.push(`/(shop)/shop-${index}/[[...filters]]`);
    else if (bucket === 18) routes.push(`/files-${index}/[...path]`);
    else routes.push(`/(marketing)/teams/team-${index}/[team]/projects/[project]`);
  }
  return routes;
}

describe("router parity with the previous implementation", () => {
  it("matches random route tables identically, including their errors", () => {
    const random = createRandom(0x5eed);
    let built = 0;
    for (let table = 0; table < 1500; table++) {
      const invalid = table % 3 === 0;
      const count = 1 + Math.floor(random.next() * 12);
      const patterns = Array.from({ length: count }, () => randomPattern(random, invalid));
      const inputs = patterns.map((path, meta) => (meta % 2 ? path : { path, meta }));
      if (expectSameRouter(inputs, pathsFor(patterns, random))) built++;
    }
    // The generator must exercise working tables, not only errors.
    expect(built).toBeGreaterThan(400);
  });

  it("matches tricky precedence identically", () => {
    const tables = [
      ["/docs/[[...slug]]", "/docs/[id]", "/docs/a", "/[...all]", "/(g)/docs/[id]/edit", "/"],
      ["/[[...all]]", "/[...rest]", "/[id]", "/docs", "/docs/[...slug]", "/docs/[[...opt]]/x"],
      ["/users/[id]", "/users/settings", "/[category]/settings", "/shop/[item]", "/:a/:b"],
      ["/caf%C3%A9", "/[id]", "/hello%20farm", "/%61/[id]", "/b/[...rest]"],
      ["/docs/*slug?", "/docs/:id", "/docs/:id/*rest", "/(marketing)/docs/intro"],
      ["/%ZZ", "/[not.valid]", "/docs/[not.valid]", "/docs/[id]", "/.well-known/[file]"],
      ["/a", "/(g)/a"],
      ["/a", "/%61"],
      ["/[id]", "/:slug"],
      ["/docs/[...slug]", "/docs/*rest"],
      ["/docs/[[...slug]]", "/docs/*rest?"],
    ];
    const random = createRandom(7);
    for (const patterns of tables) {
      expectSameRouter(patterns, pathsFor(patterns, random));
      expectSameRouter([...patterns].reverse(), pathsFor(patterns, random));
    }
  });

  it("matches a large docs-heavy table identically", () => {
    const patterns = realisticTable(1000);
    const random = createRandom(11);
    const inputs = patterns.map((path, meta) => ({ path, meta }));
    // Every dynamic route and a sample of the static ones; each miss scans the whole table.
    const sample = patterns.filter((pattern, index) => pattern.includes("[") || index % 10 === 0);
    expect(expectSameRouter(inputs, pathsFor(sample, random))).toBe(true);
    expect(expectSameRouter([...inputs].reverse(), pathsFor(patterns.slice(0, 200), random))).toBe(
      true,
    );
  });

  it("parses, normalizes and matches single patterns identically", () => {
    const random = createRandom(99);
    const extra = ["", "/", "//", "a", "a/", "/a//b/", "\\a", "/(g)", "/[...a]/b", "/%2e"];
    const patterns = [
      ...extra,
      ...Array.from({ length: 2500 }, (_, index) => randomPattern(random, index % 2 === 0)),
    ];
    for (const pattern of patterns) {
      expect(
        outcome(() => parseRoutePattern(pattern)),
        pattern,
      ).toEqual(outcome(() => reference.parseRoutePattern(pattern)));
      expect(normalizeRoutePattern(pattern), pattern).toBe(
        reference.normalizeRoutePattern(pattern),
      );
      const paths = pathsFor([pattern], random).slice(5);
      const results = (router: typeof reference) =>
        paths.map((pathname) => [
          pathname,
          outcome(() => router.matchFarmRoute(pattern, pathname)),
          outcome(() => router.isFarmRouteActive(pattern, pathname, { exact: true })),
          outcome(() => router.isFarmRouteActive(pattern, pathname, { exact: false })),
        ]);
      expect(results({ ...reference, matchFarmRoute, isFarmRouteActive }), pattern).toEqual(
        results(reference),
      );
    }
    expect(buildFarmRoutePath("/(g)/docs/[id]", { id: "a b" })).toBe("/docs/a%20b");
  });

  it("keeps the page, API and router pattern helpers identical", () => {
    const random = createRandom(1234);
    const syntaxes: RoutePatternSyntax[] = ["page", "router", "api"];
    const extra = ["[...a b]", "[[...x.y]]", "[a.b]", "[...]", "[[...]]", "[]", ":", "*", "*?"];
    for (let index = 0; index < 3000; index++) {
      let pattern = randomPattern(random, index % 2 === 0);
      if (index % 5 === 0) pattern += `/${random.pick(extra)}`;
      for (const syntax of syntaxes) {
        for (const [name, run, expected] of [
          ["shape", getRoutePatternShape, reference.getRoutePatternShape],
          ["specificity", getRoutePatternSpecificity, reference.getRoutePatternSpecificity],
          ["terminal", assertTerminalCatchAll, reference.assertTerminalCatchAll],
          ["unique", assertUniqueRouteParameters, reference.assertUniqueRouteParameters],
        ] as const) {
          expect(
            outcome(() => run(pattern, syntax)),
            `${name} ${syntax} ${pattern}`,
          ).toEqual(outcome(() => expected(pattern, syntax)));
        }
      }
      expect(
        outcome(() => assertBrowserStableRoutePath(pattern)),
        pattern,
      ).toEqual(outcome(() => reference.assertBrowserStableRoutePath(pattern)));
    }
    // Both edges of the C0 and C1 control ranges, raw and encoded, and surrogate pairs and halves.
    const codes = [0x1f, 0x20, 0x7e, 0x7f, 0x80, 0x85, 0x9f, 0xa0, 0xd800];
    const escapes = ["%1F", "%20", "%7E", "%7F", "%C2%80", "%C2%9F", "%C2%A0", "%F0%9F%98%80"];
    for (const pattern of [
      ...codes.map((code) => `/a${String.fromCharCode(code)}b`),
      ...escapes.map((escape) => `/a${escape}b`),
      `/${String.fromCharCode(0xd83d, 0xde00)}`,
    ]) {
      expect(
        outcome(() => assertBrowserStableRoutePath(pattern)),
        pattern,
      ).toEqual(outcome(() => reference.assertBrowserStableRoutePath(pattern)));
      expect(
        outcome(() => createFarmRouter([pattern]).routes),
        pattern,
      ).toEqual(outcome(() => reference.createReferenceRouter([pattern]).routes));
    }
  });

  it("orders specificity keys as compareRouteSpecificity orders sequences", () => {
    const random = createRandom(42);
    const kinds: RouteSegmentSpecificity[] = [
      "static",
      "dynamic",
      "catch-all",
      "optional-catch-all",
    ];
    const sequence = () =>
      Array.from({ length: Math.floor(random.next() * 5) }, () => random.pick(kinds));
    for (let index = 0; index < 20_000; index++) {
      const left = sequence();
      const right = sequence();
      const leftKey = getRouteSpecificityKey(left);
      const rightKey = getRouteSpecificityKey(right);
      const keyOrder = leftKey === rightKey ? 0 : leftKey < rightKey ? -1 : 1;
      expect(keyOrder, `${left} vs ${right}`).toBe(Math.sign(compareRouteSpecificity(left, right)));
    }
  });
});
