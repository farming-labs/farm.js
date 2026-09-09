import { describe, expect, it } from "vitest";
import { resolveHintsOptions } from "./config.js";

describe("resolveHintsOptions", () => {
  it("enables the useful development checks with no configuration", () => {
    expect(resolveHintsOptions()).toEqual({
      accessibility: { level: "AA", impact: "moderate", exclude: [], rules: {} },
      performance: { lcp: 2_500, cls: 0.1, inp: 200, hydration: 500, navigation: 1_000 },
      html: true,
      thirdParty: { slow: 1_000, allow: [] },
      report: "overlay",
      overlay: { position: "bottom-right", open: "issues" },
      maxIssues: 50,
    });
  });

  it("supports concise booleans and focused advanced settings", () => {
    expect(
      resolveHintsOptions({
        accessibility: { level: "AAA", exclude: ["[data-preview]"] },
        performance: { lcp: 3_000 },
        html: false,
        thirdParty: { slow: 700, allow: ["trusted.example"] },
        report: "both",
        overlay: { position: "bottom-left", open: "collapsed" },
        maxIssues: 12,
      }),
    ).toMatchObject({
      accessibility: { level: "AAA", exclude: ["[data-preview]"] },
      performance: { lcp: 3_000, cls: 0.1 },
      html: false,
      thirdParty: { slow: 700, allow: ["trusted.example"] },
      report: "both",
      overlay: { position: "bottom-left", open: "collapsed" },
      maxIssues: 12,
    });
  });

  it("rejects invalid or ambiguous configuration", () => {
    expect(() => resolveHintsOptions(null as never)).toThrow("must be an object");
    expect(() => resolveHintsOptions({ report: "terminal" as never })).toThrow("report");
    expect(() => resolveHintsOptions({ performance: { lcp: 0 } })).toThrow("positive");
    expect(() => resolveHintsOptions({ thirdParty: { allow: [""] } })).toThrow("non-empty");
    expect(() =>
      resolveHintsOptions({ accessibility: { rules: { label: { enabled: "yes" as never } } } }),
    ).toThrow("enabled must be boolean");
  });
});
