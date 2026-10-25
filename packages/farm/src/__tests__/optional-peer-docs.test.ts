// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

const DOCS_HINT =
  'Install "@farming-labs/docs" to use the docs engine: pnpm add @farming-labs/docs';

describe("@farming-labs/docs as an optional peer", () => {
  afterEach(() => {
    vi.doUnmock("@farming-labs/docs");
    vi.resetModules();
  });

  it("names the install command when docs are enabled without the package", async () => {
    vi.resetModules();
    vi.doMock("@farming-labs/docs", () => {
      throw Object.assign(
        new Error(
          "Cannot find package '@farming-labs/docs' imported from /app/node_modules/@farm.js/core/dist/x.mjs",
        ),
        { code: "ERR_MODULE_NOT_FOUND" },
      );
    });
    const { docsEngine, loadFarmDocsEngine } = await import("../docs/engine");

    await expect(loadFarmDocsEngine()).rejects.toThrow(
      `docs is enabled, but @farming-labs/docs is not installed. ${DOCS_HINT}`,
    );
    expect(() => docsEngine()).toThrow("before loadFarmDocsEngine() resolved");

    // A failed load is retried once the package is installed.
    vi.doUnmock("@farming-labs/docs");
    await expect(loadFarmDocsEngine()).resolves.toMatchObject({
      renderDocsLlmsTxt: expect.any(Function),
      resolveApiReferenceOpenApiDiscovery: expect.any(Function),
    });
    expect(docsEngine().renderDocsLlmsTxt).toBeTypeOf("function");
  });

  it("keeps the docs modules free of a static @farming-labs/docs value import", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    for (const file of ["handler.ts", "api.ts", "../config.ts", "adapter.ts", "types.ts"]) {
      const source = await fs.readFile(path.join(import.meta.dirname, "../docs", file), "utf8");
      const valueImport = /^import\s+(?!type\b)[^;]*from\s+"@farming-labs\/docs(?:\/[^"]*)?";/m;
      expect(valueImport.test(source), file).toBe(false);
    }
  });
});
