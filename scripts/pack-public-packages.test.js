const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { packPublicPackages } = require("./pack-public-packages");
const { findCoreDependencyProblems, readPublicPackages } = require("./public-packages");

test("public packages share the app's core and accept the next core minor", () => {
  assert.deepEqual(findCoreDependencyProblems(readPublicPackages()), []);
});

test("reports pinned cores and peer ranges that refuse the next minor", () => {
  const core = { name: "@farm.js/core", version: "0.1.78", manifest: {} };
  const pkg = (name, manifest) => ({ name, version: "0.1.0", manifest });
  const dev = { devDependencies: { "@farm.js/core": "workspace:*" } };

  assert.deepEqual(
    findCoreDependencyProblems([
      core,
      pkg("@farm.js/cli", { dependencies: { "@farm.js/core": "workspace:*" } }),
      pkg("@farm.js/ok", { ...dev, peerDependencies: { "@farm.js/core": ">=0.1.50 <0.3.0" } }),
      pkg("@farm.js/pinned", { dependencies: { "@farm.js/core": "workspace:*" } }),
      pkg("@farm.js/capped", { ...dev, peerDependencies: { "@farm.js/core": ">=0.1.0 <0.2.0" } }),
      pkg("@farm.js/exact", { ...dev, peerDependencies: { "@farm.js/core": "workspace:*" } }),
      pkg("@farm.js/ahead", { ...dev, peerDependencies: { "@farm.js/core": ">=0.1.79 <0.3.0" } }),
      pkg("@farm.js/unlinked", { peerDependencies: { "@farm.js/core": ">=0.1.0 <0.3.0" } }),
    ]),
    [
      "@farm.js/pinned: move @farm.js/core from `dependencies` to `peerDependencies` (with `workspace:*` in `devDependencies`).",
      "@farm.js/capped: the @farm.js/core peer `>=0.1.0 <0.2.0` refuses core 0.2.0; raise its upper bound past 0.2.0.",
      "@farm.js/exact: write the @farm.js/core peer as `>=<floor> <<ceiling>`, not `workspace:*`.",
      "@farm.js/ahead: the @farm.js/core peer `>=0.1.79 <0.3.0` excludes the workspace core 0.1.78.",
      '@farm.js/unlinked: add `"@farm.js/core": "workspace:*"` to `devDependencies`.',
    ],
  );
});

test("discovers every public package without consulting the registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-public-packages-"));
  try {
    for (const [directory, manifest] of [
      ["public-b", { name: "@farm.js/b", version: "1.0.0" }],
      ["private", { name: "@farm.js/private", version: "1.0.0", private: true }],
      ["private-string", { name: "@farm.js/private-string", version: "1.0.0", private: "true" }],
      ["public-a", { name: "@farm.js/a", version: "2.0.0", private: false }],
    ]) {
      const packageDirectory = path.join(root, "packages", directory);
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        `${JSON.stringify(manifest)}\n`,
      );
    }
    const linkedPackageDirectory = path.join(root, "linked-package");
    fs.mkdirSync(linkedPackageDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(linkedPackageDirectory, "package.json"),
      `${JSON.stringify({ name: "@farm.js/linked", version: "3.0.0" })}\n`,
    );
    fs.symlinkSync(
      linkedPackageDirectory,
      path.join(root, "packages", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.deepEqual(
      readPublicPackages(root).map(({ name, version }) => ({ name, version })),
      [
        { name: "@farm.js/a", version: "2.0.0" },
        { name: "@farm.js/b", version: "1.0.0" },
        { name: "@farm.js/linked", version: "3.0.0" },
      ],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("packs each public package into an isolated temporary directory", () => {
  const packages = [
    { dir: "/workspace/a", name: "@farm.js/a", version: "1.0.0" },
    { dir: "/workspace/b", name: "@farm.js/b", version: "2.0.0" },
  ];
  const calls = [];
  let packDirectory;

  packPublicPackages({
    packages,
    run(command, args, options) {
      calls.push({ command, args, cwd: options.cwd });
      packDirectory = args.at(-1);
      fs.writeFileSync(path.join(packDirectory, `${path.basename(options.cwd)}.tgz`), "archive");
    },
  });

  assert.deepEqual(
    calls.map(({ command, args, cwd }) => ({ command, args: args.slice(0, 2), cwd })),
    [
      { command: "pnpm", args: ["pack", "--pack-destination"], cwd: "/workspace/a" },
      { command: "pnpm", args: ["pack", "--pack-destination"], cwd: "/workspace/b" },
    ],
  );
  assert.equal(fs.existsSync(packDirectory), false);
});

test("fails when a package does not produce an archive", () => {
  let packDirectory;
  assert.throws(
    () =>
      packPublicPackages({
        packages: [{ dir: "/workspace/a", name: "@farm.js/a", version: "1.0.0" }],
        run(_command, args) {
          packDirectory = args.at(-1);
        },
      }),
    /Expected 1 package archive.*produced 0/,
  );
  assert.ok(packDirectory);
  assert.equal(fs.existsSync(packDirectory), false);
});
