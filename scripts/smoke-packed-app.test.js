const assert = require("node:assert/strict");
const { test } = require("node:test");

const { collectFarmPackages, pinToArchives } = require("./smoke-packed-app");

test("packs only workspace packages reachable from the template", () => {
  const packages = new Map(
    ["@farm.js/core", "@farm.js/cli", "@farm.js/devtools", "@farm.js/vue"].map((name) => [
      name,
      { name, dir: require("node:path").join(__dirname, "..", "packages", dirFor(name)) },
    ]),
  );
  const collected = collectFarmPackages(["@farm.js/cli", "@farm.js/devtools", "react"], packages);
  assert.ok(collected.includes("@farm.js/core"), "cli and devtools depend on core");
  assert.ok(!collected.includes("@farm.js/vue"));
  assert.ok(!collected.includes("react"));
});

test("pins direct and transitive Farm packages to local archives", () => {
  const archives = new Map([
    ["@farm.js/core", "/tmp/archives/farm.js-core-0.1.0.tgz"],
    ["@farm.js/cli", "/tmp/archives/farm.js-cli-0.1.0.tgz"],
  ]);
  const pinned = pinToArchives(
    {
      dependencies: { "@farm.js/core": "0.1.0", react: "^19.0.0" },
      devDependencies: { "@farm.js/cli": "0.1.0" },
      pnpm: { overrides: { esbuild: "0.25.0" } },
    },
    archives,
  );
  assert.equal(pinned.dependencies["@farm.js/core"], "file:/tmp/archives/farm.js-core-0.1.0.tgz");
  assert.equal(pinned.dependencies.react, "^19.0.0");
  assert.equal(pinned.devDependencies["@farm.js/cli"], "file:/tmp/archives/farm.js-cli-0.1.0.tgz");
  assert.equal(pinned.pnpm.overrides.esbuild, "0.25.0");
  assert.equal(pinned.pnpm.overrides["@farm.js/core"], "file:/tmp/archives/farm.js-core-0.1.0.tgz");
});

function dirFor(name) {
  return {
    "@farm.js/core": "farm",
    "@farm.js/cli": "farm-cli",
    "@farm.js/devtools": "farm-devtools",
    "@farm.js/vue": "farm-vue",
  }[name];
}
