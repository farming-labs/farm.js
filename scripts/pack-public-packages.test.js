const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { packPublicPackages } = require("./pack-public-packages");
const { readPublicPackages } = require("./public-packages");

test("discovers every public package without consulting the registry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "farm-public-packages-"));
  try {
    for (const [directory, manifest] of [
      ["public-b", { name: "@farm.js/b", version: "1.0.0" }],
      ["private", { name: "@farm.js/private", version: "1.0.0", private: true }],
      ["public-a", { name: "@farm.js/a", version: "2.0.0", private: false }],
    ]) {
      const packageDirectory = path.join(root, "packages", directory);
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        `${JSON.stringify(manifest)}\n`,
      );
    }

    assert.deepEqual(
      readPublicPackages(root).map(({ name, version }) => ({ name, version })),
      [
        { name: "@farm.js/a", version: "2.0.0" },
        { name: "@farm.js/b", version: "1.0.0" },
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
