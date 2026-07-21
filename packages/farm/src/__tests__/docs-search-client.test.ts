// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  generateFarmDocsSearchBootstrapRuntime,
  generateFarmDocsSearchClientRuntime,
  isFarmDocsSearchEnabled,
} from "../docs/search-client";

describe("Farm docs search client", () => {
  it("captures search interactions before the client bundle is ready", () => {
    const runtime = generateFarmDocsSearchBootstrapRuntime();

    expect(runtime).toContain("__farmDocsSearchBootstrap");
    expect(runtime).toContain("[data-search-full]");
    expect(runtime).toContain("__FARM_DOCS_SEARCH_PENDING__");
    expect(runtime).toContain("__FARM_MOUNT_DOCS_SEARCH__?.()");
    expect(runtime).toContain('queue("keyboard",event)');
  });

  it("mounts the shared Omni React search component", () => {
    const runtime = generateFarmDocsSearchClientRuntime(true, "/theme/docs-command-search.mjs");

    expect(runtime).toContain('import("/theme/docs-command-search.mjs")');
    expect(runtime).toContain("DocsCommandSearch");
    expect(runtime).toContain("data-farm-docs-search-root");
    expect(runtime).toContain("container.dataset.api || '/api/docs'");
    expect(runtime).toContain("React.createElement");
    expect(runtime).toContain("__FARM_DOCS_SEARCH_BRIDGE_ACTIVE__");
    expect(runtime).toContain("FarmDocsSearchBridge");
    expect(runtime).toContain("queueMicrotask");
    expect(runtime).toContain("trigger.click()");
    expect(runtime).not.toContain("fetch('/api/docs");
  });

  it("omits the theme import when docs search is disabled", () => {
    const runtime = generateFarmDocsSearchClientRuntime(false);

    expect(runtime).not.toContain("@farming-labs/theme");
    expect(runtime).not.toContain("DocsCommandSearch");
  });

  it("omits docs search when the optional client module is unavailable", () => {
    const runtime = generateFarmDocsSearchClientRuntime(true, undefined);

    expect(runtime).not.toContain("@farming-labs/theme");
    expect(runtime).not.toContain("DocsCommandSearch");
    expect(runtime).toContain("return false");
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
