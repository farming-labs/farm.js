// @vitest-environment node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";
import * as configuration from "../agent-config";
import * as rendering from "../agent-json-ld";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

it("preserves the existing rendering bindings and configuration validation", () => {
  expect(configuration.serializeJsonLd).toBe(rendering.serializeJsonLd);
  expect(configuration.renderFarmAgentJsonLd).toBe(rendering.renderFarmAgentJsonLd);
  expect(configuration.resolveFarmAgentConfig(undefined).jsonLd).toBe(false);
  expect(() =>
    configuration.resolveFarmAgentConfig({ crawlers: { search: "invalid" } as any }),
  ).toThrow();
});

describe.each(["production", "development"])("published client metadata (%s)", (environment) => {
  it.each(["import", "require"])("keeps configuration helpers out of %s bundles", async (kind) => {
    for (const name of ["Link", "getTheme", "createClientPluginManager"]) {
      const result = await build({
        absWorkingDir: packageRoot,
        stdin: {
          contents: `
            ${kind === "import" ? `import { ${name} } from "@farm.js/core/client";` : `const { ${name} } = require("@farm.js/core/client");`}
            globalThis.used = ${name};
          `,
          resolveDir: packageRoot,
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "esm",
        minify: true,
        define: { "process.env.NODE_ENV": JSON.stringify(environment) },
        external: ["react", "react-dom", "react-dom/*"],
      });
      const code = result.outputFiles[0].text;
      for (const helper of [
        "resolveFarmAgentConfig",
        "resolveFarmAgentCrawlers",
        "resolveFarmLlmsTxtConfig",
        "resolveFarmNoindexPreviews",
      ]) {
        expect(code.includes(helper), `${name} retains ${helper}`).toBe(false);
      }
      // Metadata rendering and escaping still run during client navigation.
      expect(code.includes("serializeJsonLd")).toBe(true);
    }
  });
});
