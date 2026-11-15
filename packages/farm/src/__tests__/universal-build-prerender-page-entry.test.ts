// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { getManifestPageEntry } from "../nitro/universal-build";
import type { FarmRouteRuntimeManifest, FarmRouteRuntimeManifestEntry } from "../route-runtime";

const page = (
  pattern: string,
  rendering: FarmRouteRuntimeManifestEntry["rendering"] = "static",
): FarmRouteRuntimeManifestEntry => ({ kind: "page", pattern, rendering, runtime: "auto" });

const manifestOf = (routes: FarmRouteRuntimeManifestEntry[]): FarmRouteRuntimeManifest => ({
  version: 1,
  routes,
});

const NativeRegExp = globalThis.RegExp;
afterEach(() => {
  globalThis.RegExp = NativeRegExp;
});

describe("prerender manifest page lookup", () => {
  it("answers with the most specific page, whatever the manifest order", () => {
    const manifest = manifestOf([
      page("/docs/[[...slug]]", "dynamic"),
      page("/docs/[...slug]", "dynamic"),
      page("/docs/[section]", "dynamic"),
      { kind: "api", pattern: "/docs/guide", rendering: "dynamic", runtime: "edge" },
      page("/docs/guide"),
    ]);

    expect(getManifestPageEntry(manifest, "/docs/guide")?.pattern).toBe("/docs/guide");
    expect(getManifestPageEntry(manifest, "/docs/other")?.pattern).toBe("/docs/[section]");
    expect(getManifestPageEntry(manifest, "/docs/a/b")?.pattern).toBe("/docs/[...slug]");
    expect(getManifestPageEntry(manifest, "/blog")).toBeUndefined();
  });

  it("keeps manifest order between equally specific pages", () => {
    const manifest = manifestOf([page("/[lang]/a", "dynamic"), page("/[locale]/a")]);

    expect(getManifestPageEntry(manifest, "/en/a")?.rendering).toBe("dynamic");
  });

  it("compiles each page pattern once per manifest, not once per pathname", () => {
    let compiled = 0;
    globalThis.RegExp = new Proxy(NativeRegExp, {
      construct(target, args) {
        compiled++;
        return Reflect.construct(target, args);
      },
    });
    const pages = 300;
    const manifest = manifestOf(
      Array.from({ length: pages }, (_, index) => page(`/docs/section-${index % 7}/page-${index}`)),
    );

    for (let index = 0; index < pages; index++) {
      expect(
        getManifestPageEntry(manifest, `/docs/section-${index % 7}/page-${index}`)?.pattern,
      ).toBe(`/docs/section-${index % 7}/page-${index}`);
    }

    // Once per manifest: a matcher and the segment ranks of each pattern (about a dozen
    // expressions). Per pathname, every pattern compiled again: 90,000 here.
    expect(compiled).toBeLessThan(pages * 20);
    const another = manifestOf(manifest.routes.filter((entry) => entry.pattern.endsWith("-1")));
    expect(getManifestPageEntry(another, "/docs/section-1/page-1")?.pattern).toBe(
      "/docs/section-1/page-1",
    );
  });
});
