import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROGRESS_COLOR,
  DEFAULT_PROGRESS_DELAY_MS,
  DEFAULT_PROGRESS_HEIGHT,
  resolveProgressOptions,
} from "./config.js";

describe("resolveProgressOptions", () => {
  it("fills the defaults", () => {
    expect(resolveProgressOptions({})).toEqual({
      delayMs: DEFAULT_PROGRESS_DELAY_MS,
      color: DEFAULT_PROGRESS_COLOR,
      height: DEFAULT_PROGRESS_HEIGHT,
    });
  });

  it("keeps explicit values and trims the color", () => {
    expect(resolveProgressOptions({ delayMs: 0, color: " var(--accent) ", height: 2 })).toEqual({
      delayMs: 0,
      color: "var(--accent)",
      height: 2,
    });
  });

  it("rejects non-object options", () => {
    expect(() => resolveProgressOptions(null as never)).toThrow(
      "progress options must be an object",
    );
    expect(() => resolveProgressOptions([] as never)).toThrow("progress options must be an object");
  });

  it("rejects an enabled flag", () => {
    expect(() => resolveProgressOptions({ enabled: false } as never)).toThrow(
      "remove progress() from plugins",
    );
  });

  it("rejects an invalid delay", () => {
    expect(() => resolveProgressOptions({ delayMs: -1 })).toThrow("delayMs");
    expect(() => resolveProgressOptions({ delayMs: Number.NaN })).toThrow("delayMs");
  });

  it("rejects an invalid color", () => {
    expect(() => resolveProgressOptions({ color: "  " })).toThrow("color");
  });

  it("rejects an invalid height", () => {
    expect(() => resolveProgressOptions({ height: 0 })).toThrow("height");
    expect(() => resolveProgressOptions({ height: Number.POSITIVE_INFINITY })).toThrow("height");
  });
});
