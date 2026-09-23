import { expect, it } from "vitest";
import { matchRoute as matchFarmPageRoute, parseRoutePath } from "../../../../farm/src/utils";
import {
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from "../../../../farm/src/routing/specificity";
import { generateRscEntry } from "./rsc.js";

function createMatcher(paths: string[]) {
  const entry = generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "routing",
    debug: false,
  });
  const start = entry.indexOf("function filePathToRoute(");
  const end = entry.indexOf("function mergeDocumentMetadata(", start);
  return new Function(
    "pages",
    "React",
    "debug",
    "parseRoutePath",
    "matchFarmPageRoute",
    "compareRouteSpecificity",
    "getRoutePatternSpecificity",
    `${entry.slice(start, end)}; return matchRoute;`,
  )(
    Object.fromEntries(paths.map((p) => [p, { default: () => p }])),
    {},
    () => {},
    parseRoutePath,
    matchFarmPageRoute,
    compareRouteSpecificity,
    getRoutePatternSpecificity,
  );
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
