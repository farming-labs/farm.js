import { describe, expect, it } from "vitest";
import type { AnalyzerBuildReport } from "./analyze";
import { renderAnalyzerReport } from "./report";

describe("renderAnalyzerReport", () => {
  it("renders the useful sections and escapes build-controlled text", () => {
    const sizes = { raw: 100, gzip: 80, brotli: 70 };
    const report: AnalyzerBuildReport = {
      schemaVersion: 1,
      generatedAt: "2026-08-28T00:00:00.000Z",
      preset: '<node & "edge">',
      metric: "gzip",
      outputDirectory: ".farm/.output",
      publicDirectory: ".farm/.output/public",
      summary: {
        pages: 1,
        client: sizes,
        server: sizes,
        public: sizes,
        largestPage: { route: "/", sizes },
      },
      pages: [{ route: "/", file: "index.html", assets: ["entry.js"], sizes }],
      clientAssets: [{ path: "entry.js", kind: "script", sizes, usedByPages: 1 }],
      serverAssets: [{ path: "server.mjs", kind: "script", sizes }],
      publicAssets: [{ path: "entry.js", kind: "script", sizes, usedByPages: 1 }],
      notes: ["A useful note"],
    };

    const html = renderAnalyzerReport(report, [
      { kind: "page", name: "/", actual: 80, limit: 70, metric: "gzip" },
    ]);

    expect(html).toContain("Your production build, explained.");
    expect(html).toContain("Client bundles");
    expect(html).toContain("1 size limit was exceeded");
    expect(html).toContain("&lt;node &amp; &quot;edge&quot;&gt;");
    expect(html).not.toContain('<node & "edge">');
  });
});
