import { describe, expect, it } from "vitest";
import { resolvePrefetchOptions } from "./config.js";

describe("resolvePrefetchOptions", () => {
  it("fills the defaults and freezes the result", () => {
    const resolved = resolvePrefetchOptions({});

    expect(resolved).toEqual({ mode: "intent", intentDelayMs: 50, allow: [], deny: [] });
    expect(Object.isFrozen(resolved)).toBe(true);
    expect(Object.isFrozen(resolved.allow)).toBe(true);
    expect(JSON.parse(JSON.stringify(resolved))).toEqual(resolved);
  });

  it("keeps the given options", () => {
    expect(
      resolvePrefetchOptions({
        mode: "viewport",
        intentDelayMs: 0,
        allow: ["/posts/[id]", "/docs/[[...slug]]"],
        deny: ["/admin/[...rest]"],
      }),
    ).toEqual({
      mode: "viewport",
      intentDelayMs: 0,
      allow: ["/posts/[id]", "/docs/[[...slug]]"],
      deny: ["/admin/[...rest]"],
    });
  });

  it("does not share the caller's arrays", () => {
    const allow = ["/posts/[id]"];
    const resolved = resolvePrefetchOptions({ allow });
    allow.push("/admin");

    expect(resolved.allow).toEqual(["/posts/[id]"]);
  });

  it("accepts every Link prefetch mode", () => {
    for (const mode of ["intent", "viewport", "render", "none"] as const) {
      expect(resolvePrefetchOptions({ mode }).mode).toBe(mode);
    }
  });

  it("rejects a non-object", () => {
    expect(() => resolvePrefetchOptions(null as never)).toThrow("an options object");
    expect(() => resolvePrefetchOptions([] as never)).toThrow("an options object");
  });

  it("reports every problem at once", () => {
    let message = "";
    try {
      resolvePrefetchOptions({
        mode: "hover",
        intentDelayMs: -1,
        allow: "/posts",
        deny: ["admin"],
        strategy: "both",
      } as never);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("`strategy` is not an option");
    expect(message).toContain('`mode` must be one of "intent", "viewport", "render", "none"');
    expect(message).toContain("`intentDelayMs` must be a number");
    expect(message).toContain("`allow` must be an array of route patterns");
    expect(message).toContain('`deny` entry "admin" must be a route pattern starting with "/"');
  });

  it("rejects a non-finite delay", () => {
    expect(() => resolvePrefetchOptions({ intentDelayMs: Number.NaN })).toThrow(
      "`intentDelayMs` must be a number",
    );
    expect(() => resolvePrefetchOptions({ intentDelayMs: "50" as never })).toThrow(
      "`intentDelayMs` must be a number",
    );
  });

  it("rejects a pattern core's route matcher rejects", () => {
    expect(() => resolvePrefetchOptions({ deny: ["/[...rest]/edit"] })).toThrow(
      '`deny` entry "/[...rest]/edit" is not a valid route pattern',
    );
    expect(() => resolvePrefetchOptions({ allow: ["/[id]/[id]"] })).toThrow(
      '`allow` entry "/[id]/[id]" is not a valid route pattern',
    );
  });
});
