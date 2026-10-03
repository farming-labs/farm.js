const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  assertInstalledManifests,
  collectRequiredPeers,
  exportTarget,
  packageExportSpecifiers,
} = require("./smoke-packed-integrations");

test("lists exact public export specifiers", () => {
  assert.deepEqual(
    packageExportSpecifiers({
      name: "@farm.js/example",
      exports: { ".": {}, "./client": {}, "./features/*": {}, internal: {} },
    }),
    ["@farm.js/example", "@farm.js/example/client"],
  );
});

test("resolves conditional export targets", () => {
  assert.equal(exportTarget({ types: "./dist/index.d.ts" }, "types"), "./dist/index.d.ts");
  assert.equal(
    exportTarget([{ browser: "./dist/browser.js" }, { default: "./dist/index.js" }], "import"),
    "./dist/index.js",
  );
});

test("rejects incompatible required peer ranges", () => {
  assert.throws(
    () =>
      collectRequiredPeers([
        { manifest: { peerDependencies: { react: "^18.0.0" } } },
        { manifest: { peerDependencies: { react: "^19.0.0" } } },
      ]),
    /peer range conflict for react: \^18\.0\.0 versus \^19\.0\.0/,
  );
});

test("reports the package and entrypoint for missing packed declarations", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "farm-packed-manifest-test-"));
  const packageDirectory = path.join(fixture, "node_modules", "@farm.js", "jobs");
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(packageDirectory, "package.json"),
    JSON.stringify({
      name: "@farm.js/jobs",
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
        "./client": { types: "./dist/client.d.ts", import: "./dist/client.js" },
      },
    }),
  );

  try {
    assert.throws(
      () => assertInstalledManifests(fixture, ["@farm.js/jobs"]),
      /@farm\.js\/jobs export \. points to missing packed declarations at \.\/dist\/index\.d\.ts/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
