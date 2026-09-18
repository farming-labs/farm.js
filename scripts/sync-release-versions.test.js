const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

test("keeps the standalone StackBlitz example on current Farm releases", () => {
  const stackblitzManifest = JSON.parse(
    fs.readFileSync(path.join(root, "examples/stackblitz/package.json"), "utf8"),
  );

  for (const dependencyGroup of ["dependencies", "devDependencies"]) {
    for (const [packageName, version] of Object.entries(
      stackblitzManifest[dependencyGroup] ?? {},
    )) {
      if (!packageName.startsWith("@farm.js/")) continue;

      const packageDirectory = packageName
        .replace("@farm.js/", "farm-")
        .replace("farm-core", "farm");
      const workspaceManifest = JSON.parse(
        fs.readFileSync(path.join(root, "packages", packageDirectory, "package.json"), "utf8"),
      );

      assert.equal(
        version,
        workspaceManifest.version,
        `${packageName} must match its workspace release version`,
      );
    }
  }
});
