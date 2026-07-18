// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  generateFarmDocsSearchClientRuntime,
  isFarmDocsSearchEnabled,
} from "../docs/search-client";

describe("Farm docs search client", () => {
  it("mounts the shared Omni React search component", () => {
    const runtime = generateFarmDocsSearchClientRuntime(true, "/theme/docs-command-search.mjs");

    expect(runtime).toContain('import("/theme/docs-command-search.mjs")');
    expect(runtime).toContain("DocsCommandSearch");
    expect(runtime).toContain("data-farm-docs-search-root");
    expect(runtime).toContain("container.dataset.api || '/api/docs'");
    expect(runtime).toContain("React.createElement");
    expect(runtime).not.toContain("fetch('/api/docs");
  });

  it("omits the theme import when docs search is disabled", () => {
    const runtime = generateFarmDocsSearchClientRuntime(false);

    expect(runtime).not.toContain("@farming-labs/theme");
    expect(runtime).not.toContain("DocsCommandSearch");
  });

  it("follows the docs search config", () => {
    const docs = {
      enabled: true,
      entry: "/docs",
      config: { entry: "docs" },
    } as const;

    expect(isFarmDocsSearchEnabled(docs)).toBe(true);
    expect(
      isFarmDocsSearchEnabled({
        ...docs,
        config: { ...docs.config, search: false },
      }),
    ).toBe(false);
    expect(
      isFarmDocsSearchEnabled({
        ...docs,
        config: { ...docs.config, search: { provider: "simple", enabled: false } },
      }),
    ).toBe(false);
  });
});
