const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const readManifest = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

test("workspace Vitest packages share one exact version and an explicit Vite peer", () => {
  const core = readManifest("packages/farm/package.json");
  const version = core.devDependencies.vitest;
  assert.match(version, /^\d+\.\d+\.\d+$/);
  const manifests = fs.globSync(
    [
      "packages/*/package.json",
      "examples/*/package.json",
      "examples/*/*/package.json",
      "docs/package.json",
    ],
    { cwd: root, exclude: (name) => name.split(/[\\/]/).includes("node_modules") },
  );
  for (const file of manifests) {
    const manifest = readManifest(file);
    const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
    for (const [name, declared] of Object.entries(dependencies)) {
      if (name === "vitest" || name.startsWith("@vitest/")) {
        assert.equal(declared, version, `${file}: ${name} must match core's Vitest version`);
      }
    }
    if (dependencies.vitest) {
      assert.equal(
        dependencies.vite,
        core.dependencies.vite,
        `${file}: declare the supported Vite peer`,
      );
    }
  }
});
