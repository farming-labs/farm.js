// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isFarmRouteActive } from "../router";
import { runtimeSources, signature } from "../../../../benchmarks/slot-route-inputs/runtime.mjs";

type Slot = {
  id: number;
  pattern: string;
  ownerPattern: string;
  name: string;
  fallback: boolean;
  interception: boolean;
  containerId: string;
  module: object;
};
type Match = Slot & { params: Record<string, string> };
const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
const code = runtimeSources(source);
const slots = (patterns: string[], extra: Partial<Slot> = {}): Slot[] =>
  patterns.map((pattern, id) => ({
    id,
    pattern,
    ownerPattern: "/",
    name: "panel",
    fallback: false,
    interception: false,
    containerId: `slot-${id}`,
    module: {},
    ...extra,
  }));

function runtime(input: readonly Slot[], arm: "baseline" | "candidate" = "candidate") {
  const instrumented = code[arm]
    .replace(
      "function splitRuntimePath(pathname) {",
      "function splitRuntimePath(pathname) { splits++;",
    )
    .replace(
      "function decodeRouteSegment(segment) {",
      "function decodeRouteSegment(segment) { decodes++;",
    )
    .replace(
      "function routeSlotSpecificity(slot) {",
      "function routeSlotSpecificity(slot) { scores++;",
    )
    .replace(
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) {",
      "function matchRuntimePathSegments(patternSegments, pathnameSegments) { generic++;",
    )
    .replaceAll("segment.match(", "matchSegment(segment, ");
  return new Function(
    "routeSlots",
    "isFarmRouteActive",
    `
    let splits = 0, decodes = 0, scores = 0, regex = 0, generic = 0;
    function matchSegment(segment, pattern) { regex++; return segment.match(pattern); }
    ${instrumented}
    return {
      select: matchRouteSlots,
      counts: () => ({ splits, decodes, scores, regex, generic }),
      reset: () => { splits = decodes = scores = regex = generic = 0; },
      capture: params => Object.getOwnPropertyDescriptor(params, farmCatchAllParamSegments),
    };
  `,
  )(input, isFarmRouteActive) as {
    select(pathname: string, from?: unknown): Match[];
    counts(): { splits: number; decodes: number; scores: number; regex: number; generic: number };
    reset(): void;
    capture(params: Record<string, string>): PropertyDescriptor | undefined;
  };
}

function compare(input: readonly Slot[], paths: string[], from?: unknown) {
  const before = runtime(input, "baseline"),
    after = runtime(input);
  for (const pathname of paths) {
    let expected: Match[];
    try {
      expected = before.select(pathname, from);
    } catch (error) {
      expect(() => after.select(pathname, from)).toThrow(error as Error);
      continue;
    }
    expect(signature(after.select(pathname, from)), `${pathname} from ${String(from)}`).toEqual(
      signature(expected),
    );
  }
  return after;
}

describe("production slot route preparation", () => {
  it.each(["/route99/a%252Fb", "/missing/%ZZ", "/route99", "/route99/one/two"])(
    "prepares fixed candidates once and decodes the request once: %s",
    (pathname) => {
      const input = slots(Array.from({ length: 100 }, (_, i) => `/route${i}/[id]`));
      const r = compare(input, [pathname]);
      r.reset();
      r.select(pathname);
      expect(r.counts()).toEqual({
        splits: 1,
        decodes: pathname.split("/").length - 1,
        scores: 0,
        regex: 0,
        generic: 0,
      });
    },
  );

  it("does not recompute specificity when many candidates match", () => {
    const r = runtime(slots(Array(100).fill("/catalog/[id]")));
    expect(r.counts().splits).toBe(100);
    expect(r.counts().scores).toBe(100);
    r.reset();
    expect(r.select("/catalog/one")[0].id).toBe(0);
    expect(r.counts()).toEqual({ splits: 1, decodes: 2, scores: 0, regex: 0, generic: 0 });
  });

  it("does no request parsing for no slots, fallback-only, excluded owners or interceptions", () => {
    for (const input of [
      [],
      slots(["/"], { fallback: true }),
      slots(["/other/[id]"], { ownerPattern: "/other" }),
      slots(["/[id]"], { interception: true }),
    ]) {
      const r = runtime(input);
      r.reset();
      expect(r.select("/value")).toEqual(runtime(input, "baseline").select("/value"));
      expect(r.counts()).toEqual({ splits: 0, decodes: 0, scores: 0, regex: 0, generic: 0 });
    }
    expect(runtime(slots(["/"], { fallback: true })).counts().splits).toBe(0);
  });

  it("preserves stable specificity, interception priority, first fallback and group ordering", () => {
    const input = [
      ...slots(["/shop/[[...rest]]", "/shop/[id]", "/shop/new", "/shop/[name]"], {
        ownerPattern: "/shop",
      }),
      ...slots(["/shop/[id]"], { id: 4, ownerPattern: "/shop", interception: true }),
      ...slots(["/shop", "/shop"], { id: 5, ownerPattern: "/shop", fallback: true }),
      ...slots(["/shop/[[...rest]]"], { id: 6, name: "alpha", ownerPattern: "/shop" }),
      ...slots(["/[[...all]]"], { id: 7, name: "root" }),
      ...slots(["/shop/[id]/child"], { id: 8, name: "nested", ownerPattern: "/shop/[id]" }),
    ];
    for (const from of [
      undefined,
      "/shop?x=1#y",
      "/outside",
      "https://farm.local/shop",
      "/shopper",
      1,
    ])
      compare(
        input,
        ["/shop", "/shop/", "/shop/new", "/shop/42", "/shop/42/child", "/shopper"],
        from,
      );
    expect(
      runtime(input)
        .select("/shop/new")
        .map((x) => x.id),
    ).toEqual([7, 6, 2]);
    expect(
      runtime(input)
        .select("/shop/new", "/shop")
        .map((x) => x.id),
    ).toEqual([7, 6, 4]);
    const fallbacks = slots(["/", "/"], { fallback: true });
    expect(runtime(fallbacks).select("/anything")[0].id).toBe(0);
    const root = slots(["/", "/[[...rest]]"]);
    compare(root, ["/", "///", "/child"]);
    expect(runtime(root).select("/")[0].id).toBe(0);
  });

  it("retains per-entry owner checks even when group keys collide", () => {
    const input = [
      ...slots(["/[[...rest]]"], { ownerPattern: "/a", name: "b:c", id: 0 }),
      ...slots(["/[[...rest]]"], { ownerPattern: "/a:b", name: "c", id: 1 }),
    ];
    compare(input, ["/a/value", "/a:b/value", "/a", "/a:b"]);
    expect(runtime(input).select("/a:b/value")[0].id).toBe(1);
  });

  it.each([
    "/docs/[[...slug]]",
    "/docs/[...slug]",
    "/docs/:rest*/end",
    "/docs/*tail?/end",
    "/docs/*/end",
    "/docs/:a*/x/:b*/end",
    "/docs/a*b/[id]",
  ])("retains the complete matcher and hidden captures for %s", (pattern) => {
    const r = compare(slots([pattern]), [
      "/docs",
      "/docs/end",
      "/docs/a%2Fb/%ZZ/end",
      "/docs/a/x/c/end",
      "/docs/a%252Fb",
    ]);
    r.reset();
    r.select("/docs/end");
    expect(r.counts().generic).toBe(1);
    expect(r.counts().splits).toBe(1);
  });

  it("matches the original selector for fixed-segment edge cases", () => {
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
    for (const first of segments)
      for (const second of segments)
        compare(slots([`/${first}/${second}`]), [
          "/literal/value",
          "/literal//value/",
          "/%6Citeral/a%252Fb",
          "/%ZZ/%E0%A4",
          "/caf%C3%A9/a%252Fb",
          "/[]/[a%0Ab]",
          "/a:b/[[id]]",
          "/a/b/c",
          "/a",
          "/",
        ]);
  });

  it("preserves owner prefix semantics and native intercept URL errors", () => {
    for (const ownerPattern of ["/", "/café", "/a%2Fb", "/[id]", "/docs/[[...slug]]"])
      for (const from of [
        undefined,
        "/caf%C3%A9",
        "/docs/a%252Fb?x=1",
        "//other.test/docs",
        "/%ZZ",
      ])
        compare(
          slots(["/[[...rest]]"], { ownerPattern, interception: true }),
          ["/caf%C3%A9", "/a%252Fb", "/docs/a%2Fb", "/%ZZ", "/"],
          from,
        );
    for (const input of [[], slots(["/"], { fallback: true })]) {
      expect(() => runtime(input, "baseline").select("/", "//[")).toThrow(TypeError);
      expect(() => runtime(input).select("/", "//[")).toThrow(TypeError);
    }
  });

  it("does not mutate frozen descriptors or share params and catch-all captures between requests", () => {
    for (const pattern of ["/[id]/:id", "/[[...rest]]"]) {
      const input = Object.freeze(slots([pattern]).map((slot) => Object.freeze(slot)));
      const r = runtime(input),
        first = r.select("/one/two")[0],
        second = r.select("/one/two")[0];
      expect(first.params).not.toBe(second.params);
      expect(r.capture(first.params)).toEqual(r.capture(second.params));
      expect(r.capture(first.params)!.value).not.toBe(r.capture(second.params)!.value);
      first.params.id = "changed";
      r.capture(first.params)!.value.rest = ["changed"];
      compare(input, ["/one/two", "/different/value", "/one/two"]);
      expect(signature(r.select("/one/two"))).toEqual(signature([second]));
      expect(second.module).toBe(input[0].module);
      expect(Object.keys(second).sort()).toEqual([...Object.keys(input[0]), "params"].sort());
    }
  });
});
