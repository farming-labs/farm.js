import { describe, expect, it } from "vitest";
import { timingSafeStringEqual } from "../secret-compare";

describe("timingSafeStringEqual", () => {
  it("returns true only for identical strings", () => {
    expect(timingSafeStringEqual("s3cr3t-token", "s3cr3t-token")).toBe(true);
    expect(timingSafeStringEqual("", "")).toBe(true);
  });

  it("returns false when content differs", () => {
    expect(timingSafeStringEqual("s3cr3t-token", "s3cr3t-tokeX")).toBe(false);
    // A prefix match must not pass (the whole point of the constant-time check).
    expect(timingSafeStringEqual("s3cr3t", "s3cr3t-token")).toBe(false);
    expect(timingSafeStringEqual("s3cr3t-token", "s3cr3t")).toBe(false);
  });

  it("returns false for a length mismatch without throwing", () => {
    expect(timingSafeStringEqual("a", "")).toBe(false);
    expect(timingSafeStringEqual("", "b")).toBe(false);
  });
});
