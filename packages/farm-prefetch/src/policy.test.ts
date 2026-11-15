import { describe, expect, it } from "vitest";
import { isDataSaving, isPathAllowed, readNavigableHref, readPrefetchMode } from "./policy.js";

function anchor(attributes: Record<string, string>) {
  return {
    getAttribute: (name: string) => attributes[name] ?? null,
    hasAttribute: (name: string) => name in attributes,
  };
}

describe("readPrefetchMode", () => {
  it("uses the plugin default when the link has no attribute", () => {
    expect(readPrefetchMode(null, "intent")).toBe("intent");
    expect(readPrefetchMode(null, "viewport")).toBe("viewport");
  });

  it("uses the link's own mode", () => {
    expect(readPrefetchMode("render", "intent")).toBe("render");
    expect(readPrefetchMode("none", "viewport")).toBe("none");
  });

  it("never prefetches for an unknown value", () => {
    expect(readPrefetchMode("", "intent")).toBe("none");
    expect(readPrefetchMode("off", "intent")).toBe("none");
    expect(readPrefetchMode("hover", "intent")).toBe("none");
    expect(readPrefetchMode("true", "render")).toBe("none");
  });
});

describe("readNavigableHref", () => {
  it("returns a relative href", () => {
    expect(readNavigableHref(anchor({ href: "/about" }))).toBe("/about");
    expect(readNavigableHref(anchor({ href: "posts/1?tab=a" }))).toBe("posts/1?tab=a");
    expect(readNavigableHref(anchor({ href: "/about", target: "_self" }))).toBe("/about");
  });

  it("skips anchors the router does not navigate", () => {
    expect(readNavigableHref(anchor({}))).toBeNull();
    expect(readNavigableHref(anchor({ href: "" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "#top" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "/file.pdf", download: "" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "/about", target: "_blank" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "https://example.com/" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "//example.com/" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "mailto:a@example.com" }))).toBeNull();
    expect(readNavigableHref(anchor({ href: "javascript:void(0)" }))).toBeNull();
  });

  it("leaves Link anchors to Link", () => {
    expect(readNavigableHref(anchor({ href: "/about", "data-farm-link": "" }))).toBeNull();
  });
});

describe("isPathAllowed", () => {
  it("allows every path when allow is empty", () => {
    expect(isPathAllowed("/anything", [], [])).toBe(true);
  });

  it("restricts to the allow list with Farm route patterns", () => {
    expect(isPathAllowed("/posts/1", ["/posts/[id]"], [])).toBe(true);
    expect(isPathAllowed("/posts/1/comments", ["/posts/[id]"], [])).toBe(false);
    expect(isPathAllowed("/about", ["/posts/[id]"], [])).toBe(false);
    expect(isPathAllowed("/admin", ["/admin/[...rest]"], [])).toBe(false);
    expect(isPathAllowed("/admin/a/b", ["/admin/[...rest]"], [])).toBe(true);
    expect(isPathAllowed("/docs", ["/docs/[[...slug]]"], [])).toBe(true);
    expect(isPathAllowed("/docs/a/b", ["/docs/[[...slug]]"], [])).toBe(true);
    expect(isPathAllowed("/pricing/", ["/pricing"], [])).toBe(true);
  });

  it("lets deny win over allow", () => {
    expect(isPathAllowed("/admin/users", ["/[...slug]"], ["/admin/[...rest]"])).toBe(false);
    expect(isPathAllowed("/posts/1", ["/[...slug]"], ["/admin/[...rest]"])).toBe(true);
  });
});

describe("isDataSaving", () => {
  it("reads Save-Data", () => {
    expect(isDataSaving({ navigator: { connection: { saveData: true } } })).toBe(true);
    expect(isDataSaving({ navigator: { connection: { saveData: false } } })).toBe(false);
  });

  it("reads prefers-reduced-data", () => {
    const matchMedia = (query: string) => ({
      matches: query === "(prefers-reduced-data: reduce)",
    });
    expect(isDataSaving({ navigator: {}, matchMedia })).toBe(true);
    expect(isDataSaving({ navigator: {}, matchMedia: () => ({ matches: false }) })).toBe(false);
  });

  it("reads a missing or throwing matchMedia as not saving", () => {
    expect(isDataSaving({})).toBe(false);
    expect(
      isDataSaving({
        matchMedia: () => {
          throw new Error("unsupported");
        },
      }),
    ).toBe(false);
  });
});
