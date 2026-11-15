import { describe, expect, it, vi } from "vitest";
import { matchesImagePathPattern } from "../image-pattern";

describe("cached image path patterns", () => {
  it.each([
    ["/assets/*", "/assets/a.png", true],
    ["/assets/*", "/assets/nested/a.png", false],
    ["/assets/**", "/assets/nested/a.png", true],
    ["/assets/**", "/private/a.png", false],
    ["/a.(b)+[c]$^?", "/a.(b)+[c]$^?", true],
    ["/a.(b)+[c]$^?", "/aXbbbbc", false],
    ["/assets/*.png", "/assets/a.png/extra", false],
    ["/assets/*.png", "/prefix/assets/a.png", false],
    ["/assets/*", "/assets/a%2Fb", true],
    ["/assets/*", "/assets/", true],
    ["/assets/**", "/assets", false],
  ])("preserves %s matching %s as %s on repeated calls", (pathname, value, expected) => {
    const pattern = { pathname };
    expect(matchesImagePathPattern(value, pattern)).toBe(expected);
    expect(matchesImagePathPattern(value, pattern)).toBe(expected);
  });

  it("does not recompile warmed policies for different requests", () => {
    const pattern = { pathname: "/assets/**" };
    matchesImagePathPattern("/assets/first.png", pattern);
    const replace = vi.spyOn(String.prototype, "replace");
    let count: number;
    try {
      matchesImagePathPattern("/assets/second.png", pattern);
      matchesImagePathPattern("/private/third.png", pattern);
      count = replace.mock.calls.length;
    } finally {
      replace.mockRestore();
    }
    expect(count).toBe(0);
  });

  it("invalidates pathname edits without retaining previous permissions", () => {
    const pattern = { pathname: "/assets/**" };
    expect(matchesImagePathPattern("/assets/a.png", pattern)).toBe(true);
    pattern.pathname = "/public/*";
    expect(matchesImagePathPattern("/assets/a.png", pattern)).toBe(false);
    expect(matchesImagePathPattern("/public/a.png", pattern)).toBe(true);
    expect(matchesImagePathPattern("/public/nested/a.png", pattern)).toBe(false);
    expect(matchesImagePathPattern("/private/a.png", {})).toBe(true);
  });
});
