// @vitest-environment node
import { describe, expect, it } from "vitest";
import { generateRuntimePathMatcherSource } from "../nitro/universal-build";
import { compileConfigRoutePattern, resolveConfigRoutePathname } from "../plugins/route-pattern";

const prodMatch = new Function(
  `${generateRuntimePathMatcherSource()}\nreturn matchRuntimePathPattern;`,
)() as (pattern: string, pathname: string) => Record<string, string> | null;

function devMatches(pattern: string, pathname: string): boolean {
  // Mirrors the dev plugins: compile the source once, then test the resolved
  // request pathname against it (see plugins/headers.ts and rewrites.ts).
  const { regex } = compileConfigRoutePattern(pattern);
  return regex.test(resolveConfigRoutePathname(pathname).pathname);
}

function prodMatches(pattern: string, pathname: string): boolean {
  return prodMatch(pattern, pathname) !== null;
}

/**
 * A redirect, rewrite, or header rule is authored once and has to behave the
 * same in `farm dev` as in a built app. These pairs pin the two matchers to
 * one another rather than to a hand-written expectation, so a change to either
 * side has to be made deliberately on both.
 */
const cases: Array<{ pattern: string; path: string; expected: boolean; why: string }> = [
  // Zero-consume non-terminal wildcards: a `*`/`:name*` in the middle of a
  // pattern is allowed to match no segments at all and collapse the
  // surrounding separators, which is the production behavior and matches the
  // path-to-regexp convention the config syntax is modeled on.
  { pattern: "/x/*/y", path: "/x/y", expected: true, why: "bare wildcard consumes zero segments" },
  {
    pattern: "/docs/:slug*/end",
    path: "/docs/end",
    expected: true,
    why: "named catch-all consumes zero segments",
  },
  { pattern: "/x/*/y", path: "/x/a/y", expected: true, why: "wildcard consumes one segment" },
  { pattern: "/x/*/y", path: "/x/a/b/y", expected: true, why: "wildcard consumes many segments" },
  { pattern: "/x/*/y", path: "/x/a/b", expected: false, why: "suffix must still match" },
  {
    pattern: "/docs/:slug*/end",
    path: "/docs/a/b/end",
    expected: true,
    why: "named catch-all consumes many segments",
  },

  // Trailing slashes are normalized away before matching.
  { pattern: "/old", path: "/old/", expected: true, why: "trailing slash on the request" },
  { pattern: "/old", path: "/old", expected: true, why: "exact" },
  { pattern: "/old", path: "/older", expected: false, why: "not a prefix match" },
  { pattern: "/", path: "/", expected: true, why: "root" },

  // Ordinary shapes that already agreed, kept so a fix cannot regress them.
  { pattern: "/blog/:slug", path: "/blog/hello", expected: true, why: "named param" },
  { pattern: "/blog/:slug", path: "/blog/a/b", expected: false, why: "param is one segment" },
  { pattern: "/files/:path*", path: "/files/a/b/c", expected: true, why: "terminal catch-all" },
  { pattern: "/files/:path*", path: "/files", expected: true, why: "terminal catch-all is empty" },
];

describe("config route matcher dev/prod parity", () => {
  for (const { pattern, path, expected, why } of cases) {
    it(`${pattern} vs ${path} (${why})`, () => {
      expect({ dev: devMatches(pattern, path), prod: prodMatches(pattern, path) }).toEqual({
        dev: expected,
        prod: expected,
      });
    });
  }

  // Agreeing on whether a rule fires is not enough: both sides also have to
  // capture the same thing, or the rule fires in both and rewrites to two
  // different destinations.
  const captureCases: Array<{ pattern: string; path: string; name: string; expected: string }> = [
    { pattern: "/x/*/y", path: "/x/a/b/y", name: "wildcard", expected: "a/b" },
    { pattern: "/x/*/y", path: "/x/y", name: "wildcard", expected: "" },
    { pattern: "/docs/:slug*/end", path: "/docs/a/b/end", name: "slug", expected: "a/b" },
    { pattern: "/docs/:slug*/end", path: "/docs/end", name: "slug", expected: "" },
    { pattern: "/files/:path*", path: "/files/a/b", name: "path", expected: "a/b" },
    { pattern: "/files/:path*", path: "/files", name: "path", expected: "" },
  ];

  for (const { pattern, path, name, expected } of captureCases) {
    it(`captures the same value for ${pattern} vs ${path}`, () => {
      const compiled = compileConfigRoutePattern(pattern);
      const match = resolveConfigRoutePathname(path).pathname.match(compiled.regex);
      const token = compiled.tokens.find(
        (entry) => (entry.kind === "wildcard" ? "wildcard" : entry.name) === name,
      );
      const devCapture = match?.[token!.captureIndex] ?? "";
      const prodCapture = prodMatch(pattern, path)?.[name] ?? "";

      expect({ dev: devCapture, prod: prodCapture }).toEqual({ dev: expected, prod: expected });
    });
  }
});
