// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveFarmComponentExtensions } from "../renderer";
import { isFarmAppRuntimeFile } from "../vite";

const appDirs = ["/app/src/app"];
const extensions = (rendererExtensions: string[] = []) =>
  new Set([...resolveFarmComponentExtensions(rendererExtensions), ".md", ".mdx"]);

describe("files that refresh routes in farm dev", () => {
  it("counts route modules with the renderer's component extensions", () => {
    const leaf = extensions([".leaf"]);

    expect(isFarmAppRuntimeFile("/app/src/app/contact/page.leaf", appDirs, leaf)).toBe(true);
    expect(isFarmAppRuntimeFile("/app/src/app/blog/layout.leaf", appDirs, leaf)).toBe(true);
    expect(isFarmAppRuntimeFile("/app/src/app/feed/@modal/default.leaf", appDirs, leaf)).toBe(true);
    expect(isFarmAppRuntimeFile("/app/src/app/contact/page.svelte", appDirs, leaf)).toBe(false);
  });

  it("counts Svelte and Vue pages when their renderer declares them", () => {
    expect(
      isFarmAppRuntimeFile("/app/src/app/contact/page.svelte", appDirs, extensions([".svelte"])),
    ).toBe(true);
    expect(
      isFarmAppRuntimeFile("/app/src/app/contact/page.vue", appDirs, extensions([".vue"])),
    ).toBe(true);
  });

  it("keeps the built-in files", () => {
    const builtIn = extensions();

    for (const file of [
      "page.tsx",
      "about/page.md",
      "docs/page.mdx",
      "layout.ts",
      "middleware.ts",
      "api/hello/route.ts",
      "sitemap.ts",
      "opengraph-image.png",
      "twitter-image.alt.txt",
    ]) {
      expect(isFarmAppRuntimeFile(`/app/src/app/${file}`, appDirs, builtIn), file).toBe(true);
    }
    for (const file of ["page.css", "components/button.tsx", "layout.module.css"]) {
      expect(isFarmAppRuntimeFile(`/app/src/app/${file}`, appDirs, builtIn), file).toBe(false);
    }
    expect(isFarmAppRuntimeFile("/app/src/lib/page.tsx", appDirs, builtIn)).toBe(false);
  });
});
