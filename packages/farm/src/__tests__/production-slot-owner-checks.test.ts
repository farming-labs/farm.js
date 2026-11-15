// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isFarmRouteActive } from "../router";
import { runtimeSources, signature } from "../../../../benchmarks/slot-route-inputs/runtime.mjs";

const source = fs.readFileSync(path.join(process.cwd(), "src/nitro/universal-build.ts"), "utf8");
const slot = (id: number, ownerPattern: string, extra = {}) =>
  Object.freeze({
    id,
    ownerPattern,
    name: "panel",
    pattern: "/[[...rest]]",
    containerId: `slot-${id}`,
    fallback: false,
    interception: false,
    module: {},
    ...extra,
  });
type Slot = ReturnType<typeof slot>;
function runtime(input: readonly Slot[], arm: "prepared" | "candidate" = "candidate") {
  let calls: string[] = [];
  const code = runtimeSources(source, input)[arm];
  const select = new Function("routeSlots", "isFarmRouteActive", code + ";return matchRouteSlots;")(
    input,
    (pattern: string, pathname: string, options: { exact: boolean }) => {
      calls.push(pattern);
      return isFarmRouteActive(pattern, pathname, options);
    },
  );
  return {
    code,
    select,
    calls: () => calls,
    reset: () => {
      calls = [];
    },
  };
}
function compare(input: readonly Slot[], pathname: string, from?: string) {
  const before = runtime(input, "prepared"),
    after = runtime(input);
  let expected;
  try {
    expected = signature(before.select(pathname, from));
  } catch (error) {
    expect(() => after.select(pathname, from)).toThrow(error as Error);
    return after;
  }
  expect(signature(after.select(pathname, from))).toEqual(expected);
  return after;
}

describe("production shared slot owner checks", () => {
  it.each(["/app/value", "/outside", "/app/a%252Fb", "/app/%ZZ"])(
    "checks a repeated non-root owner once per request: %s",
    (pathname) => {
      const input = Object.freeze(Array.from({ length: 100 }, (_, id) => slot(id, "/app")));
      const r = compare(input, pathname);
      expect(r.calls()).toEqual(["/app"]);
      r.reset();
      r.select("/outside");
      expect(r.calls()).toEqual(["/app"]);
      r.reset();
      expect(r.select("/app/next")[0].params.rest).toBe("app/next");
      expect(r.calls()).toEqual(["/app"]);
    },
  );

  it("emits the original prepared selector for empty, root-only, single and unique owners", () => {
    for (const input of [
      [],
      [slot(0, "/")],
      [slot(0, "/app")],
      [slot(0, "/"), slot(1, "/")],
      [slot(0, "/"), slot(1, "/"), slot(2, "/app")],
      Array.from({ length: 100 }, (_, id) => slot(id, `/owner${id}`)),
    ]) {
      expect(runtime(input).code).toBe(runtime(input, "prepared").code);
      expect(runtime(input).code).not.toContain("sharedRouteSlotOwners");
    }
  });

  it("caches false as well as true results across nonadjacent owners without conflating group keys", () => {
    const input = [
      slot(0, "/a", { name: "b:c" }),
      slot(1, "/a:b", { name: "c" }),
      slot(2, "/a", { name: "other" }),
      slot(3, "/unique"),
      slot(4, "/a:b", { name: "other" }),
    ];
    for (const pathname of ["/a/value", "/a:b/value", "/unique", "/outside"]) {
      const r = compare(input, pathname);
      expect(r.calls()).toEqual(["/a", "/a:b", "/unique"]);
    }
  });

  it("does not reuse a current-path result for the interception background", () => {
    const input = [slot(0, "/app", { interception: true }), slot(1, "/app", { fallback: true })];
    for (const from of [undefined, "/outside", "/app?x=1#top", "/app/other"]) {
      const r = compare(input, "/app/photo/42", from);
      expect(r.calls()).toHaveLength(from ? 2 : 1);
    }
    for (const arm of ["prepared", "candidate"] as const)
      expect(() => runtime(input, arm).select("/outside", "//[")).toThrow(TypeError);
  });

  it("preserves prefix semantics and separate manifests", () => {
    for (const owner of ["/", "/[team]", "/café", "/a%2Fb", "/docs/[[...slug]]", "/docs/[...slug]"])
      for (const pathname of ["/", "/team/one", "/caf%C3%A9/one", "/a%252Fb", "/docs/a%2Fb/%ZZ"])
        compare([slot(0, owner), slot(1, owner, { name: "other" })], pathname);
    const a = runtime([slot(0, "/a"), slot(1, "/a")]);
    const b = runtime([slot(0, "/b"), slot(1, "/b")]);
    expect(a.select("/a/item")).toHaveLength(1);
    expect(b.select("/a/item")).toHaveLength(0);
    expect(b.select("/b/item")).toHaveLength(1);
    expect(a.select("/b/item")).toHaveLength(0);
  });
});
