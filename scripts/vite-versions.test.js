const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const readManifest = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));

test("Farm development dependencies use the Vite version shipped by core", () => {
  const version = readManifest("packages/farm/package.json").dependencies.vite;
  // Match the workspace's package globs, plus the standalone compiler benchmark.
  const manifests = fs.globSync(
    [
      "packages/*/package.json",
      "examples/*/package.json",
      "examples/*/*/package.json",
      "docs/package.json",
      "benchmarks/react-optimizer/package.json",
      "packages/create-farm-app/templates/*/package.json",
    ],
    {
      cwd: root,
      exclude: (name) =>
        name.split(/[\\/]/).some((part) => part === "node_modules" || part === "stackblitz"),
    },
  );
  const mismatches = [];
  for (const file of manifests) {
    const manifest = readManifest(file);
    for (const field of ["dependencies", "devDependencies"]) {
      const declared = manifest[field]?.vite;
      if (declared && declared !== version) {
        mismatches.push(`${file}: ${field}.vite is ${declared}, expected ${version}`);
      }
    }
  }
  assert.deepEqual(mismatches, [], mismatches.join("\n"));
});
