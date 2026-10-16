const assert = require("node:assert/strict");
const { test } = require("node:test");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { collectFarmPackages, pinToArchives, readSmokeOptions } = require("./smoke-packed-app");

test("keeps the basic packed starter check as the default", () => {
  assert.deepEqual(readSmokeOptions([]), { template: "basic" });
});

test("selects the compiler starter explicitly without changing the default", () => {
  assert.deepEqual(readSmokeOptions(["--template", "react-compiler"]), {
    template: "react-compiler",
  });
  assert.deepEqual(readSmokeOptions(["--template=basic"]), { template: "basic" });
});

test("rejects unknown templates or arguments before creating artifacts", () => {
  assert.throws(() => readSmokeOptions(["--template", "missing"]), /Unsupported smoke template/);
  assert.throws(() => readSmokeOptions(["--template"]), /argument|value/i);
  assert.throws(() => readSmokeOptions(["--skip-browser"]), /Unknown option/);
  assert.throws(() => readSmokeOptions(["react-compiler"]), /Unexpected argument/);
});

test("fails before packing when the compiler browser is unavailable", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-packed-browser-preflight-"));
  try {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "smoke-packed-app.js"), "--template", "react-compiler"],
      {
        cwd: temporaryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          FARM_EXPERIMENT_BROWSER_PATH: path.join(temporaryRoot, "missing-browser"),
        },
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Install Chromium.*FARM_EXPERIMENT_BROWSER_PATH/);
    assert.doesNotMatch(result.stdout, /Packing|Installing/);
    assert.deepEqual(fs.readdirSync(temporaryRoot), []);
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("reports a dev server startup failure and preserves the temporary component", async () => {
  const { verifyCompilerDevelopment } = require("./smoke-packed-compiler-dev");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-compiler-dev-failure-"));
  const component = path.join(temporaryRoot, "src/components/compiler-comparison.tsx");
  const cli = path.join(temporaryRoot, "node_modules/@farm.js/cli/bin/farm.js");
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../packages/create-farm-app/templates/react-compiler/src/components/compiler-comparison.tsx",
    ),
    "utf8",
  );
  try {
    fs.mkdirSync(path.dirname(component), { recursive: true });
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(component, source);
    fs.writeFileSync(
      cli,
      'process.stderr.write("intentional dev startup failure\\n"); process.exit(7);',
    );
    await assert.rejects(
      verifyCompilerDevelopment(temporaryRoot, {
        enabled: true,
        port: 0,
        browserPath: path.join(temporaryRoot, "unused-browser"),
        screenshot: path.join(temporaryRoot, "unused.png"),
      }),
      /Compiler development smoke failed.*\nintentional dev startup failure/,
    );
    assert.equal(fs.readFileSync(component, "utf8"), source);
    assert.ok(!fs.existsSync(path.join(temporaryRoot, "unused.png")));
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("rejects Refresh code in nested production chunks without rejecting ordinary React", async () => {
  const { assertNoProductionRefresh } = require("./smoke-packed-compiler-dev");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-compiler-production-chunks-"));
  try {
    fs.mkdirSync(path.join(temporaryRoot, "chunks"));
    const chunk = path.join(temporaryRoot, "chunks/page.js");
    fs.writeFileSync(chunk, 'import React from "react";');
    await assertNoProductionRefresh(temporaryRoot);
    for (const source of [
      'import "/@react-refresh";',
      'import "/@farm/react-refresh";',
      '$RefreshReg$(Counter, "Counter");',
    ]) {
      fs.writeFileSync(chunk, source);
      await assert.rejects(
        assertNoProductionRefresh(temporaryRoot),
        /Development Refresh must not enter/,
      );
    }
  } finally {
    fs.rmSync(temporaryRoot, { force: true, recursive: true });
  }
});

test("packs only workspace packages reachable from the template", () => {
  const packages = new Map(
    ["@farm.js/core", "@farm.js/cli", "@farm.js/devtools", "@farm.js/react", "@farm.js/vue"].map(
      (name) => [name, { name, dir: path.join(__dirname, "..", "packages", dirFor(name)) }],
    ),
  );
  const collected = collectFarmPackages(["@farm.js/cli", "@farm.js/devtools", "react"], packages);
  assert.ok(collected.includes("@farm.js/core"), "cli and devtools depend on core");
  assert.ok(!collected.includes("@farm.js/vue"));
  assert.ok(!collected.includes("react"));
  const compilerPackages = collectFarmPackages(["@farm.js/react", "@farm.js/cli"], packages);
  assert.ok(compilerPackages.includes("@farm.js/react"));
  assert.ok(compilerPackages.includes("@farm.js/core"));
  assert.ok(!compilerPackages.includes("@farm.js/vue"));
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
    "@farm.js/react": "farm-react",
  }[name];
}
