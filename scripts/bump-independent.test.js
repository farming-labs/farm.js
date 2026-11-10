const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  bumpPackage,
  compareVersions,
  listChangedSince,
  readIndependentPackages,
  readSharedPackageDirs,
  rewriteVersion,
  suggestNextVersion,
} = require("./bump-independent.js");

const repoRoot = path.resolve(__dirname, "..");

function writeManifest(root, dir, manifest) {
  fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.writeFileSync(path.join(root, dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A workspace with one shared package, two independent ones, and a private one. */
function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-bump-independent-"));
  fs.writeFileSync(
    path.join(root, "bump.config.ts"),
    `export default { files: ["packages/farm/package.json", "examples/basic/src/app/page.tsx"] };\n`,
  );
  writeManifest(root, "packages/farm", { name: "@farm.js/core", version: "0.1.61" });
  writeManifest(root, "packages/farm-ui", {
    name: "@farm.js/ui",
    version: "0.1.0-beta.1",
    dependencies: { dep: { version: "untouched" } },
    files: ["dist"],
  });
  writeManifest(root, "packages/farm-mobile", { name: "@farm.js/mobile", version: "0.1.0-beta.5" });
  writeManifest(root, "packages/farm-private", { name: "farm-private", private: true });
  return root;
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function commitAll(root, message) {
  git(root, "add", "-A");
  git(root, "-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", message);
}

test("reads the shared group from the repository's bump.config.ts", () => {
  const shared = readSharedPackageDirs(repoRoot);
  assert.ok(shared.has("packages/farm"));
  assert.ok(shared.has("packages/farm-cli"));
  assert.ok(!shared.has("packages/farm-ui"), "@farm.js/ui is independently versioned");

  const independent = readIndependentPackages(repoRoot).map((pkg) => pkg.name);
  for (const name of ["@farm.js/ui", "@farm.js/mobile", "@farm.js/native", "@farm.js/react"]) {
    assert.ok(independent.includes(name), `${name} should be independent`);
  }
  assert.ok(!independent.includes("@farm.js/core"));
});

test("orders versions by SemVer precedence and suggests the next prerelease", () => {
  assert.equal(compareVersions("0.1.0-beta.10", "0.1.0-beta.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.0-beta.40"), 1);
  assert.equal(compareVersions("0.1.0-beta.2", "0.1.0-beta.2"), 0);
  assert.equal(compareVersions("0.1.0-alpha.1", "0.1.0-beta.1"), -1);
  assert.equal(suggestNextVersion("0.1.0-beta.9"), "0.1.0-beta.10");
  assert.equal(suggestNextVersion("0.1.0"), "0.1.1");
});

test("rewrites only the top-level version line", () => {
  const source = '{\n  "name": "x",\n  "version": "1.0.0",\n  "a": {"version": "9"}\n}\n';
  const { updated, before, after } = rewriteVersion(source, "1.0.1");
  assert.equal(updated, source.replace('"version": "1.0.0"', '"version": "1.0.1"'));
  assert.equal(before, '  "version": "1.0.0"');
  assert.equal(after, '  "version": "1.0.1"');
});

test("bumps one independent package by name or directory and leaves the rest alone", () => {
  const root = createWorkspace();
  try {
    const coreBefore = fs.readFileSync(path.join(root, "packages/farm/package.json"), "utf8");
    const mobileBefore = fs.readFileSync(
      path.join(root, "packages/farm-mobile/package.json"),
      "utf8",
    );
    const uiBefore = fs.readFileSync(path.join(root, "packages/farm-ui/package.json"), "utf8");

    const result = bumpPackage("@farm.js/ui", "0.1.0-beta.2", root);
    assert.equal(result.file, "packages/farm-ui/package.json");
    assert.match(result.diff, /^-  "version": "0\.1\.0-beta\.1"$/m);
    assert.match(result.diff, /^\+  "version": "0\.1\.0-beta\.2"$/m);

    const uiAfter = fs.readFileSync(path.join(root, "packages/farm-ui/package.json"), "utf8");
    assert.equal(uiAfter, uiBefore.replace("0.1.0-beta.1", "0.1.0-beta.2"));
    assert.equal(
      fs.readFileSync(path.join(root, "packages/farm/package.json"), "utf8"),
      coreBefore,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "packages/farm-mobile/package.json"), "utf8"),
      mobileBefore,
    );

    bumpPackage("packages/farm-mobile", "0.1.0-beta.6", root);
    bumpPackage("farm-mobile", "0.1.0-beta.7", root);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "packages/farm-mobile/package.json"), "utf8"))
        .version,
      "0.1.0-beta.7",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("refuses shared-group packages, invalid versions, and non-increasing versions", () => {
  const root = createWorkspace();
  try {
    assert.throws(() => bumpPackage("@farm.js/core", "0.1.62", root), /shared release group/);
    assert.throws(() => bumpPackage("@farm.js/ui", "beta", root), /not a valid version/);
    assert.throws(() => bumpPackage("@farm.js/ui", "0.1.0-beta.1", root), /must be greater/);
    assert.throws(() => bumpPackage("@farm.js/ui", "0.0.9", root), /must be greater/);
    assert.throws(() => bumpPackage("farm-private", "1.0.0", root), /No public workspace package/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("lists independent packages with shipped changes since a ref", () => {
  const root = createWorkspace();
  try {
    git(root, "init", "-q");
    commitAll(root, "release");
    git(root, "tag", "v1");

    // Shipped: a source file in ui. Unshipped: tests, snapshots, READMEs in mobile.
    fs.mkdirSync(path.join(root, "packages/farm-ui/src"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/farm-ui/src/index.ts"), "export {};\n");
    fs.mkdirSync(path.join(root, "packages/farm-mobile/src/__snapshots__"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages/farm-mobile/src/a.test.ts"), "");
    fs.writeFileSync(path.join(root, "packages/farm-mobile/src/__snapshots__/a.snap"), "");
    fs.writeFileSync(path.join(root, "packages/farm-mobile/README.md"), "# mobile\n");
    // Shared-group packages are never listed.
    fs.writeFileSync(path.join(root, "packages/farm/index.js"), "");
    commitAll(root, "changes");

    let rows = listChangedSince("v1", root);
    assert.deepEqual(
      rows.map((row) => [row.name, row.bumped, row.suggested, row.files]),
      [["@farm.js/ui", false, "0.1.0-beta.2", ["packages/farm-ui/src/index.ts"]]],
    );

    // A manifest whose only change is its version ships nothing new, but the
    // package still reports that it has been bumped for its other changes.
    bumpPackage("@farm.js/mobile", "0.1.0-beta.6", root);
    bumpPackage("@farm.js/ui", "0.1.0-beta.2", root);
    rows = listChangedSince("v1", root);
    assert.deepEqual(
      rows.map((row) => [row.name, row.previousVersion, row.version, row.bumped]),
      [["@farm.js/ui", "0.1.0-beta.1", "0.1.0-beta.2", true]],
    );

    // Any other manifest change, such as a new export or dependency, ships.
    const manifestPath = path.join(root, "packages/farm-mobile/package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files = ["dist", "templates"];
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    rows = listChangedSince("v1", root);
    assert.deepEqual(
      rows.map((row) => row.name),
      ["@farm.js/mobile", "@farm.js/ui"],
    );

    assert.throws(() => listChangedSince("does-not-exist", root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
