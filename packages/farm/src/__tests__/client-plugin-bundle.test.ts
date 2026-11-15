// @vitest-environment node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe.each([
  ["import", "production"],
  ["require", "production"],
  ["import", "development"],
  ["require", "development"],
])("published client plugin bundle (%s, %s)", (moduleKind, environment) => {
  it.each([
    "@farm.js/core/internal/client-runtime",
    "@farm.js/core/plugin/client",
    "@farm.js/core/client",
  ])("includes diagnostics only in development via %s", async (entry) => {
    const isDev = environment === "development";
    // Resolve the real published entry, including tsup's shared chunks. Testing
    // source alone misses retained helpers introduced by package compilation.
    const result = await build({
      absWorkingDir: packageRoot,
      stdin: {
        contents: `
          ${moduleKind === "import" ? `import { createClientPluginManager } from ${JSON.stringify(entry)};` : `const { createClientPluginManager } = require(${JSON.stringify(entry)});`}
          window.farmTestRuntime = createClientPluginManager([], {
            router: { async navigate() {}, async prefetch() {} },
            isDev: ${isDev},
            isProd: ${!isDev},
            window,
          });
          void window.farmTestRuntime.start();
        `,
        resolveDir: packageRoot,
      },
      bundle: true,
      platform: "browser",
      format: "esm",
      splitting: true,
      outdir: "unused-client-plugin-bundle",
      write: false,
      metafile: true,
      minify: true,
      define: { "process.env.NODE_ENV": JSON.stringify(environment) },
      logLevel: "silent",
    });

    const code = result.outputFiles.map((file) => file.text).join("\n");
    expect(code.includes("data-farm-runtime-error-viewport"), "overlay DOM code").toBe(isDev);
    expect(code.includes("Application failed in the browser"), "overlay UI").toBe(isDev);
    const emittedInputs = Object.values(result.metafile.outputs).flatMap((output) =>
      Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0),
    );
    const diagnosticsInputs = emittedInputs.filter(([id]) =>
      /@jridgewell[\\/](?:trace-mapping|sourcemap-codec|resolve-uri)/.test(id),
    );
    expect(diagnosticsInputs.length > 0, "source-map diagnostics").toBe(isDev);
  });
});
