#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const packagesRoot = path.join(root, "packages");

const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const skipIncompatible = args.has("--skip-incompatible");
const onlyWithNodeEngine = args.has("--only-with-node-engine");
const currentNodeVersion = process.versions.node;
const currentNodeMajor = Number(currentNodeVersion.split(".")[0]);

// Packages with known Windows failures, tracked separately so the rest of the
// suite can run on windows-latest. See #440.
const WINDOWS_SKIPPED = new Set(["@farm.js/auth", "@farm.js/cli", "@farm.js/plugin"]);

function supportsCurrentNode(range) {
  if (!range) {
    return true;
  }

  const normalized = range.trim();
  if (normalized === "22.x") {
    return currentNodeMajor === 22;
  }

  const minMajorMatch = normalized.match(/^>=\s*(\d+)/);
  if (minMajorMatch) {
    return currentNodeMajor >= Number(minMajorMatch[1]);
  }

  return true;
}

const packages = fs
  .readdirSync(packagesRoot)
  .map((entry) => path.join(packagesRoot, entry))
  .filter((entryPath) => fs.statSync(entryPath).isDirectory())
  .map((packageDir) => {
    const packageJsonPath = path.join(packageDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    return {
      dir: packageDir,
      name: pkg.name,
      nodeEngine: pkg.engines?.node,
      hasTest: Boolean(pkg.scripts?.test),
    };
  })
  .filter((pkg) => pkg.hasTest)
  .sort((left, right) => left.name.localeCompare(right.name));

let tested = 0;
let skipped = 0;

for (const pkg of packages) {
  const isCompatible = supportsCurrentNode(pkg.nodeEngine);

  if (process.platform === "win32" && WINDOWS_SKIPPED.has(pkg.name)) {
    skipped += 1;
    console.log(`
> Skipping ${pkg.name} (known Windows failures, see #440)`);
    continue;
  }

  if (onlyWithNodeEngine && !pkg.nodeEngine) {
    skipped += 1;
    continue;
  }

  if (!isCompatible) {
    if (!skipIncompatible) {
      console.error(
        `\nPackage ${pkg.name} requires Node ${pkg.nodeEngine}, current Node is ${currentNodeVersion}.`,
      );
      process.exit(1);
    }

    skipped += 1;
    console.log(
      `\n> Skipping ${pkg.name} (requires Node ${pkg.nodeEngine}, current Node is ${currentNodeVersion})`,
    );
    continue;
  }

  console.log(`\n> Testing ${pkg.name}`);

  const result = spawnSync("pnpm", ["--dir", pkg.dir, "test"], {
    cwd: root,
    env: process.env,
    shell: true,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    console.error(`\nPackage tests failed: ${pkg.name}`);
    process.exit(result.status || 1);
  }

  tested += 1;
}

console.log(`\nTested ${tested} packages. Skipped ${skipped} packages.`);
