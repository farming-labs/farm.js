import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { explainFarmRoute, formatFarmRouteExplanation } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("explains a dynamic page and its inherited route behavior", async () => {
  const root = await createExplainProject();

  try {
    const explanation = await explainFarmRoute("/products/42?ref=home", { root });

    assert.equal(explanation.pathname, "/products/42");
    assert.equal(explanation.pattern, "/products/[id]");
    assert.deepEqual(explanation.params, { id: "42" });
    assert.equal(explanation.filePath, "src/app/products/[id]/page.tsx");
    assert.deepEqual(explanation.layouts, ["src/app/layout.tsx", "src/app/products/layout.tsx"]);
    assert.deepEqual(explanation.middleware, [
      { source: "file", filePath: "src/middleware.ts" },
      { source: "file", filePath: "src/app/products/middleware.ts" },
    ]);
    assert.equal(explanation.runtime.runtime, "edge");
    assert.deepEqual(explanation.runtime.regions, ["iad1"]);
    assert.equal(explanation.rendering.mode, "partial");
    assert.equal(explanation.rendering.ppr, true);
    assert.equal(explanation.cache.revalidate, 60);
    assert.deepEqual(explanation.cache.rules, ["/products/**", "/products/[id]"]);
    assert.deepEqual(explanation.metadata.dynamic, ["src/app/products/layout.tsx"]);
    assert.equal(explanation.metadata.openGraphImage, "src/app/products/opengraph-image.tsx");
    assert.equal(explanation.deployment.target, "vercel");
    assert.equal(explanation.deployment.compatible, false);

    const formatted = formatFarmRouteExplanation(explanation, { color: false });
    assert.match(formatted, /FARM \/ EXPLAIN/);
    assert.match(formatted, /\/products\/\[id\]/);
    assert.match(formatted, /incompatible/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints route explanations as JSON through the CLI", async () => {
  const root = await createExplainProject();

  try {
    const result = await execFileAsync(
      process.execPath,
      [cliBin, "explain", "/products/42", "--root", root, "--json"],
      { env: process.env },
    );
    const explanation = JSON.parse(result.stdout);
    assert.equal(explanation.pattern, "/products/[id]");
    assert.deepEqual(explanation.params, { id: "42" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createExplainProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-explain-"));
  const productDirectory = path.join(root, "src/app/products/[id]");
  await mkdir(productDirectory, { recursive: true });
  await writeFile(
    path.join(root, "farm.config.mjs"),
    [
      "export default {",
      "  deploy: { target: 'vercel', preset: 'vercel' },",
      "  routeRules: {",
      "    '/products/**': { swr: 30, runtime: 'node' },",
      "    '/products/[id]': { runtime: 'edge', regions: ['iad1'] },",
      "  },",
      "};",
      "",
    ].join("\n"),
  );
  await writeFile(path.join(root, "src/app/layout.tsx"), "export const metadata = {};\n");
  await writeFile(
    path.join(root, "src/app/products/layout.tsx"),
    "export async function generateMetadata() { return {}; }\n",
  );
  await writeFile(
    path.join(root, "src/app/products/[id]/page.tsx"),
    "export const revalidate = 60;\nexport const ppr = true;\nexport default () => null;\n",
  );
  await writeFile(path.join(root, "src/middleware.ts"), "export default () => {};\n");
  await writeFile(path.join(root, "src/app/products/middleware.ts"), "export default () => {};\n");
  await writeFile(
    path.join(root, "src/app/products/opengraph-image.tsx"),
    "export default () => null;\n",
  );
  return root;
}
