// @vitest-environment node

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const runtimeRequire = createRequire(import.meta.url);

describe("Nitro v3 package entry points", () => {
  it("loads the build API from nitro/builder", async () => {
    const builder = await import("nitro/builder");

    expect(builder).toMatchObject({
      build: expect.any(Function),
      copyPublicAssets: expect.any(Function),
      createNitro: expect.any(Function),
      prepare: expect.any(Function),
      prerender: expect.any(Function),
    });
  });

  it("resolves every public runtime entry used by generated production code", () => {
    const packagePath = runtimeRequire.resolve("nitro/package.json");
    const packageJSON = JSON.parse(readFileSync(packagePath, "utf8")) as {
      exports?: Record<string, string>;
      version?: string;
    };

    expect(packageJSON.version).toBe("3.0.260903-beta");
    expect(packageJSON.exports).toMatchObject({
      "./app": expect.any(String),
      "./builder": expect.any(String),
      "./runtime-config": expect.any(String),
      "./task": expect.any(String),
      "./types": expect.any(String),
    });

    for (const specifier of [
      "nitro/app",
      "nitro/builder",
      "nitro/runtime-config",
      "nitro/task",
      "nitro/types",
    ]) {
      expect(runtimeRequire.resolve(specifier)).toBeTruthy();
    }
  });
});
