import { describe, expect, it } from "vitest";
import { parseAnalyzerSize, resolveAnalyzerOptions } from "./config";

describe("resolveAnalyzerOptions", () => {
  it("creates a useful report with no configuration", () => {
    expect(resolveAnalyzerOptions()).toEqual({
      enabled: true,
      output: ".farm/analyze.html",
      json: false,
      open: false,
      metric: "gzip",
      limits: {
        page: undefined,
        asset: undefined,
        client: undefined,
        server: undefined,
      },
      onLimit: "error",
    });
  });

  it("keeps the CI configuration concise", () => {
    expect(
      resolveAnalyzerOptions({
        output: "reports/build.html",
        json: true,
        metric: "brotli",
        limits: { page: "200kb", asset: "1.5mb" },
        onLimit: "warn",
      }),
    ).toMatchObject({
      output: "reports/build.html",
      json: "reports/build.json",
      metric: "brotli",
      limits: { page: 204_800, asset: 1_572_864 },
      onLimit: "warn",
    });
  });

  it("supports JSON without an HTML report", () => {
    expect(resolveAnalyzerOptions({ output: false, json: true }).json).toBe(".farm/analyze.json");
  });

  it("rejects contradictory or unclear options", () => {
    expect(() => resolveAnalyzerOptions({ output: false, open: true })).toThrow(
      "needs an HTML output",
    );
    expect(() => resolveAnalyzerOptions({ metric: "zip" as never })).toThrow("metric");
    expect(() => resolveAnalyzerOptions({ json: " " })).toThrow("non-empty path");
  });
});

describe("parseAnalyzerSize", () => {
  it("accepts bytes and readable units", () => {
    expect(parseAnalyzerSize(512)).toBe(512);
    expect(parseAnalyzerSize("100kb")).toBe(102_400);
    expect(parseAnalyzerSize("1.5mb")).toBe(1_572_864);
    expect(parseAnalyzerSize("2gb")).toBe(2_147_483_648);
  });

  it("rejects zero and unitless strings", () => {
    expect(() => parseAnalyzerSize(0)).toThrow("positive");
    expect(() => parseAnalyzerSize("100" as never)).toThrow("100kb");
  });
});
