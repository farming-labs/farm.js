// @vitest-environment node

import { describe, expect, it } from "vitest";
import { collectDevStylesheetUrls } from "../server/dev-styles";

describe("collectDevStylesheetUrls", () => {
  it("collects JS-imported stylesheets, skipping what the shell already links", () => {
    const urls = collectDevStylesheetUrls([
      { id: "/src/app/globals.css", url: "/src/app/globals.css" },
      {
        id: "/node_modules/@fontsource-variable/geist/index.css",
        url: "/node_modules/@fontsource-variable/geist/index.css",
      },
      {
        id: "/node_modules/@fontsource-variable/geist-mono/index.css",
        url: "/node_modules/@fontsource-variable/geist-mono/index.css",
      },
      { id: "/src/app/layout.tsx", url: "/src/app/layout.tsx" },
      { id: "/src/components/chart.ts", url: "/src/components/chart.ts" },
    ]);
    expect(urls).toEqual([
      "/node_modules/@fontsource-variable/geist-mono/index.css",
      "/node_modules/@fontsource-variable/geist/index.css",
    ]);
  });

  it("dedupes query variants and keeps output deterministic", () => {
    const urls = collectDevStylesheetUrls([
      { id: "/src/styles/vendor.css?v=1", url: "/src/styles/vendor.css?v=1" },
      { id: "/src/styles/vendor.css", url: "/src/styles/vendor.css" },
      { id: "/src/styles/app.scss", url: "/src/styles/app.scss" },
      { id: "/src/app/globals.css?direct", url: "/src/app/globals.css?direct" },
    ]);
    expect(urls).toEqual(["/src/styles/app.scss", "/src/styles/vendor.css"]);
  });

  it("excludes CSS modules and non-rooted or missing urls", () => {
    const urls = collectDevStylesheetUrls([
      { id: "/src/button.module.css", url: "/src/button.module.css" },
      { id: "virtual:whatever.css", url: null },
      { id: "/abs/outside.css", url: "outside.css" },
    ]);
    expect(urls).toEqual([]);
  });
});
