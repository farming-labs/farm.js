import { describe, expect, it } from "vitest";
import { resolveViewTransitionsOptions } from "./config.js";

describe("resolveViewTransitionsOptions", () => {
  it("defaults to no exclusions", () => {
    expect(resolveViewTransitionsOptions({})).toEqual({ exclude: [] });
  });

  it("keeps the given patterns, trimmed", () => {
    expect(resolveViewTransitionsOptions({ exclude: [" /checkout ", "/admin/:section"] })).toEqual({
      exclude: ["/checkout", "/admin/:section"],
    });
  });

  it("rejects a non-object options value", () => {
    expect(() => resolveViewTransitionsOptions(null as never)).toThrow("must be an object");
    expect(() => resolveViewTransitionsOptions([] as never)).toThrow("must be an object");
  });

  it("rejects unknown options", () => {
    expect(() => resolveViewTransitionsOptions({ duration: 300 } as never)).toThrow(
      'does not accept option "duration"',
    );
  });

  it("rejects a non-array exclude", () => {
    expect(() => resolveViewTransitionsOptions({ exclude: "/checkout" } as never)).toThrow(
      "must be an array of route patterns",
    );
  });

  it("rejects patterns that are not pathnames", () => {
    expect(() => resolveViewTransitionsOptions({ exclude: ["checkout"] })).toThrow(
      'starting with "/"',
    );
    expect(() => resolveViewTransitionsOptions({ exclude: ["  "] })).toThrow('starting with "/"');
    expect(() => resolveViewTransitionsOptions({ exclude: [42] as never })).toThrow(
      'starting with "/"',
    );
  });
});
