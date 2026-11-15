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
  expect(configuration.resolveFarmAgentConfig(undefined).jsonLd).toEqual({ type: "WebSite" });
  expect(configuration.resolveFarmAgentConfig({ jsonLd: false }).jsonLd).toBe(false);
  expect(() =>
    configuration.resolveFarmAgentConfig({ crawlers: { search: "invalid" } as any }),
  ).toThrow();
});

describe.each(["production", "development"])("published client metadata (%s)", (environment) => {
  it.each(["import", "require"])("keeps configuration helpers out of %s bundles", async (kind) => {
    for (const name of ["Link", "getTheme", "createClientPluginManager", "navigateTo"]) {
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
      // Minified output renames functions, so look for text from their bodies.
      for (const [helper, text] of [
        ["resolveFarmAgentConfig", "must be a boolean."],
        ["resolveFarmAgentCrawlers", "agent.crawlers must be"],
        ["resolveFarmLlmsTxtConfig", "agent.llmsTxt must be"],
        ["resolveFarmNoindexPreviews", "agent.noindexPreviews must be"],
      ]) {
        expect(code.includes(text), `${name} retains ${helper}`).toBe(false);
      }
      // Metadata rendering and escaping (serializeJsonLd) still run during client navigation.
      if (name === "navigateTo") expect(code).toMatch(/\.replace\(\/<\/g,\s*["'`]\\\\u003c["'`]\)/);
    }
  });
});
