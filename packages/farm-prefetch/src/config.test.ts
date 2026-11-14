import { describe, expect, it } from "vitest";
import { resolvePrefetchOptions } from "./config.js";

describe("resolvePrefetchOptions", () => {
  it("fills the defaults and freezes the result", () => {
    const resolved = resolvePrefetchOptions({});

    expect(resolved).toEqual({
      strategy: "both",
      maxConcurrent: 6,
      allow: [],
      deny: [],
      hoverDelayMs: 50,
    });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("keeps and trims the given options", () => {
    const resolved = resolvePrefetchOptions({
      strategy: "viewport",
      maxConcurrent: 2,
      allow: [" /posts/[id] "],
      deny: ["/admin/[...rest]"],
      hoverDelayMs: 0,
    });

    expect(resolved).toEqual({
      strategy: "viewport",
      maxConcurrent: 2,
      allow: ["/posts/[id]"],
      deny: ["/admin/[...rest]"],
      hoverDelayMs: 0,
    });
  });

  it("rejects a non-object", () => {
    expect(() => resolvePrefetchOptions(null as never)).toThrow("must be an object");
    expect(() => resolvePrefetchOptions([] as never)).toThrow("must be an object");
  });

  it("rejects an unknown strategy", () => {
    expect(() => resolvePrefetchOptions({ strategy: "render" } as never)).toThrow(
      "strategy must be one of",
    );
  });

  it("rejects a non-positive maxConcurrent", () => {
    expect(() => resolvePrefetchOptions({ maxConcurrent: 0 })).toThrow(
      "maxConcurrent must be a positive integer",
    );
    expect(() => resolvePrefetchOptions({ maxConcurrent: 1.5 })).toThrow(
      "maxConcurrent must be a positive integer",
    );
  });

  it("rejects empty patterns and non-array lists", () => {
    expect(() => resolvePrefetchOptions({ allow: ["  "] })).toThrow(
      "allow must be an array of non-empty strings",
    );
    expect(() => resolvePrefetchOptions({ deny: "/admin" } as never)).toThrow(
      "deny must be an array of non-empty strings",
    );
  });

  it("rejects a negative hover delay", () => {
    expect(() => resolvePrefetchOptions({ hoverDelayMs: -1 })).toThrow(
      "hoverDelayMs must be a non-negative number",
    );
  });

  it("rejects unknown options", () => {
    expect(() => resolvePrefetchOptions({ prefetchDelay: 50 } as never)).toThrow(
      'does not accept option "prefetchDelay"',
    );
  });
});
