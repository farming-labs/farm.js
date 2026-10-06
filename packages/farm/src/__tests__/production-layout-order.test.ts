// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isFarmRouteActive } from "../router";

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
  const select = new Function(
    "layoutRoutes",
    "isFarmRouteActive",
    emitted + "; return getApplicableLayouts;",
  )(layouts, isFarmRouteActive) as (pathname: string) => Layout[];
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
});
