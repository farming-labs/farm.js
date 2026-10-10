// @vitest-environment node

import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

it("preserves native package self-resolution from the published client", () => {
  const require = createRequire(path.join(packageRoot, "dist/client.mjs"));
  expect(require.resolve("@farm.js/core/internal/client-error-overlay")).toBe(
    path.join(packageRoot, "dist/internal/client-error-overlay.cjs"),
  );
});

describe.each(["production", "development"])("published locale bundles (%s)", (environment) => {
  it.each(["import", "require"])("loads ICU only for translation via %s", async (kind) => {
    for (const [entry, name, needsICU] of [
      ["@farm.js/core/client", "Link", false],
      ["@farm.js/core/i18n/client", "t", true],
    ] as const) {
      const result = await build({
        absWorkingDir: packageRoot,
        stdin: {
          contents: `
            ${kind === "import" ? `import { ${name} } from ${JSON.stringify(entry)};` : `const { ${name} } = require(${JSON.stringify(entry)});`}
            globalThis.used = ${name};
          `,
          resolveDir: packageRoot,
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "esm",
        minify: true,
        metafile: true,
        define: { "process.env.NODE_ENV": JSON.stringify(environment) },
        external: ["react", "react-dom", "react-dom/*"],
      });
      const inputs = Object.values(result.metafile.outputs).flatMap((output) =>
        Object.entries(output.inputs).filter(([, input]) => input.bytesInOutput > 0),
      );
      expect(
        inputs.some(([file]) => /intl-messageformat|@formatjs/.test(file)),
        `${name} message formatter/parser dependency`,
      ).toBe(needsICU);
    }
  });
});
