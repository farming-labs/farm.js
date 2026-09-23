const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

function findTemplateManifests(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findTemplateManifests(entryPath);
    return entry.name === "package.json" ? [entryPath] : [];
  });
}

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

test("keeps generated templates publishable outside the workspace", () => {
  const templatesRoot = path.join(root, "packages/create-farm-app/templates");
  const dependencyGroups = [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ];

  for (const packagePath of findTemplateManifests(templatesRoot)) {
    const manifest = JSON.parse(fs.readFileSync(packagePath, "utf8"));
    for (const group of dependencyGroups) {
      for (const [name, version] of Object.entries(manifest[group] ?? {})) {
        assert.equal(
          typeof version === "string" && version.startsWith("workspace:"),
          false,
          `${path.relative(root, packagePath)} cannot publish with ${group}.${name}=${version}`,
        );
      }
    }
  }
});
