// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isFarmRouteActive } from "../router";
import { createFarmLayoutSelector } from "../routing/layout-selector";

type Layout = { pattern: string; id: number };
const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");

function runtime(input: Layout[]) {
  // Execute the actual build-time ordering before instantiating the generated
  // production selector. The client selector has a separate ordering contract.
  const sortStart = source.indexOf("  // Sort layouts by depth (root first)");
  const sortEnd = source.indexOf("\n  });", sortStart) + "\n  });".length;
  const call = source.indexOf("const virtualEntryCode = generateVirtualEntryCode(", sortEnd);
  expect(sortStart).toBeGreaterThan(-1);
  expect(call).toBeGreaterThan(sortEnd);
  expect(source.match(/\bgenerateVirtualEntryCode\(/g)).toHaveLength(2); // call + private definition
  const layouts = input.map((layout) => ({ ...layout }));
  new Function("layoutRoutes", source.slice(sortStart, sortEnd))(layouts);

  const start = source.lastIndexOf("function getApplicableLayouts(pathname) {");
  const end = source.indexOf("\n}", start) + 2;
  expect(start).toBeGreaterThan(call);
  const emitted = new Function(`return \`${source.slice(start, end)}\`;`)();
  const setup = "const selectApplicableLayouts = createFarmLayoutSelector(layoutRoutes);";
  expect(source).toContain(setup);
  const select = new Function(
    "layoutRoutes",
    "isFarmRouteActive",
    "createFarmLayoutSelector",
    setup + emitted + "; return getApplicableLayouts;",
  )(layouts, isFarmRouteActive, createFarmLayoutSelector) as (pathname: string) => Layout[];
  return { select, layouts };
}

const input = [
  "/docs/[id]/edit",
  "/docs/[...slug]",
  "/docs",
  "/docs/[id]",
  "/",
  "/docs/[[...rest]]",
  "/a/b",
  "/a",
  "/café",
  "/[section]/[id]",
  "/[section]",
  "/(group)",
  "/(group)/docs/:name",
  "/docs/*tail?",
  "/docs/[not.valid]",
  "/files/hello%20farm",
  "/%ZZ",
].map((pattern, id) => ({ pattern, id }));

function previous(layouts: Layout[], pathname: string) {
  const normalized = pathname.replace(/\/$/, "") || "/";
  return layouts
    .filter(
      (layout) =>
        layout.pattern === "/" || isFarmRouteActive(layout.pattern, normalized, { exact: false }),
    )
    .sort(
      (a, b) =>
        a.pattern.split("/").filter(Boolean).length - b.pattern.split("/").filter(Boolean).length,
    );
}

describe("production layout ordering", () => {
  it.each([
    "/",
    "/docs",
    "/docs/",
    "/docs/start",
    "/docs/start/edit",
    "/docs/start/edit/extra",
    "/a/b",
    "/a/b/",
    "/café/x",
    "/caf%C3%A9/x",
    "/docs/a%2Fb",
    "/docs/%ZZ",
    "/other/item",
    "",
    "docs/start?from=nav#part",
    "/docs//start///",
    "https://farm.test/docs/start?x=1#part",
    "//farm.test/docs/start",
    "http://[/docs/start?x=1",
    "/docs/../other/item",
    "/docs/%2e%2e/other/item",
    "/docs/a%252Fb",
    "/docs/%5Bnot.valid%5D",
    "/docs\\start",
    "/files/hello%20farm/child",
    "/%ZZ/child",
  ])("preserves layout selection and stable depth ties for %s", (pathname) => {
    const r = runtime(input);
    expect(r.select(pathname)).toEqual(previous(r.layouts, pathname));
  });

  it("does not sort immutable production layouts again on each request", () => {
    const r = runtime(input);
    const sort = vi.spyOn(Array.prototype, "sort");
    let calls;
    try {
      r.select("/docs/start/edit");
      calls = sort.mock.calls.length;
    } finally {
      sort.mockRestore();
    }
    expect(calls).toBe(0);
  });

  it("normalizes a request once and does not revalidate fixed layout patterns", () => {
    const r = runtime(input);
    const NativeURL = globalThis.URL;
    const NativeRegExp = globalThis.RegExp;
    const NativeSet = globalThis.Set;
    const counts = { urls: 0, expressions: 0, sets: 0 };
    const count = <T extends new (...args: any[]) => any>(ctor: T, key: keyof typeof counts) =>
      new Proxy(ctor, {
        construct(target, args) {
          counts[key]++;
          return Reflect.construct(target, args);
        },
      });
    let selected;
    try {
      globalThis.URL = count(NativeURL, "urls");
      globalThis.RegExp = count(NativeRegExp, "expressions");
      globalThis.Set = count(NativeSet, "sets");
      selected = r.select("/docs/start/edit");
    } finally {
      globalThis.URL = NativeURL;
      globalThis.RegExp = NativeRegExp;
      globalThis.Set = NativeSet;
    }
    expect(selected).toEqual(previous(r.layouts, "/docs/start/edit"));
    expect(counts).toEqual({ urls: 1, expressions: 0, sets: 0 });
  });

  it("does not mutate collected descriptors or share mutable result arrays", () => {
    const snapshot = structuredClone(input);
    const r = runtime(input);
    const first = r.select("/docs/start");
    const expected = previous(r.layouts, "/docs/start");
    first.reverse();
    first.pop();
    expect(r.select("/docs/start")).toEqual(expected);
    expect(input).toEqual(snapshot);
  });

  it("handles empty and root-only manifests", () => {
    expect(runtime([]).select("/missing")).toEqual([]);
    expect(runtime([{ pattern: "/", id: 0 }]).select("/missing")).toEqual([
      { pattern: "/", id: 0 },
    ]);
  });

  it("does not parse request URLs for empty or root-only manifests", () => {
    const empty = runtime([]);
    const root = runtime([{ pattern: "/", id: 0 }]);
    const NativeURL = globalThis.URL;
    let calls = 0;
    try {
      globalThis.URL = new Proxy(NativeURL, {
        construct(target, args) {
          calls++;
          return Reflect.construct(target, args);
        },
      });
      empty.select("/one");
      root.select("/two");
    } finally {
      globalThis.URL = NativeURL;
    }
    expect(calls).toBe(0);
  });

  it.each([
    "/docs/[...slug]/edit",
    "/teams/[id]/members/[id]",
    "/docs/:constructor",
    "/docs/*__proto__",
    "/files/a%2Fb",
    "/files/a%5Cb",
    "/files/a%0Ab",
    "/%2e%2e/admin",
    "/files\\private",
  ])("rejects invalid fixed patterns during preparation: %s", (pattern) => {
    let original: unknown;
    try {
      isFarmRouteActive(pattern, "/", { exact: false });
    } catch (error) {
      original = error;
    }
    expect(original).toBeInstanceOf(Error);
    expect(() => createFarmLayoutSelector([{ pattern }])).toThrow(original as Error);
  });

  it("keeps descriptor identity, equal-pattern ties and separate manifest ownership", () => {
    const first = Object.freeze({ pattern: "/docs", id: 1 });
    const second = Object.freeze({ pattern: "/docs", id: 2 });
    const select = createFarmLayoutSelector(Object.freeze([first, second]));
    expect(select("/docs")[0]).toBe(first);
    expect(select("/docs/child")[1]).toBe(second);
    expect(createFarmLayoutSelector([{ pattern: "/other", id: 3 }])("/docs")).toEqual([]);
    expect(select("/other")).toEqual([]);
    expect(select("/docs")).toEqual([first, second]);
  });
});
