import { describe, expect, it } from "vitest";
import { resolveWebVitalsOptions } from "./config.js";

describe("resolveWebVitalsOptions", () => {
  it("keeps the endpoint and freezes the result", () => {
    const resolved = resolveWebVitalsOptions({ endpoint: " /__farm/vitals " });

    expect(resolved).toEqual({ endpoint: "/__farm/vitals" });
    expect(Object.isFrozen(resolved)).toBe(true);
  });

  it("resolves to an empty object with no options", () => {
    expect(resolveWebVitalsOptions({})).toEqual({});
  });

  it("rejects a non-object", () => {
    expect(() => resolveWebVitalsOptions(null as never)).toThrow("must be an object");
    expect(() => resolveWebVitalsOptions([] as never)).toThrow("must be an object");
  });

  it("rejects an empty endpoint", () => {
    expect(() => resolveWebVitalsOptions({ endpoint: "  " })).toThrow(
      "endpoint must be a non-empty string",
    );
  });

  it("rejects onReport and points at the client entry", () => {
    expect(() => resolveWebVitalsOptions({ onReport: () => {} } as never)).toThrow(
      /webVitalsClient\(\)/,
    );
  });

  it("rejects unknown options", () => {
    expect(() => resolveWebVitalsOptions({ sampleRate: 0.5 } as never)).toThrow(
      'does not accept option "sampleRate"',
    );
  });
});
