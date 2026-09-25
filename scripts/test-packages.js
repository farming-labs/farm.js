#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const args = new Set(process.argv.slice(2).filter((arg) => arg !== "--"));
const skipIncompatible = args.has("--skip-incompatible");
const onlyWithNodeEngine = args.has("--only-with-node-engine");
const currentNodeVersion = process.versions.node;
const currentNodeMajor = Number(currentNodeVersion.split(".")[0]);

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

// Every workspace project, not just packages/*. Tests under docs/ and
// examples/ were silently never run: this script only walked packages/, and no
// workflow ran them either, so a regression test placed there read as coverage
// that did not exist. pnpm is the source of truth for what is a workspace
// project, which also handles nested ones such as
// examples/stripe-integrations/prisma-org.
function listWorkspaceProjectDirs() {
  const result = spawnSync("pnpm", ["-r", "list", "--depth", "-1", "--json"], {
    cwd: root,
    env: process.env,
    shell: true,
    encoding: "utf8",
  });

  if (result.status !== 0 || !result.stdout) {
    console.error("\nCould not list workspace projects with pnpm.");
    process.exit(result.status || 1);
  }

  return (
    JSON.parse(result.stdout)
      .map((entry) => entry?.path)
      .filter((dir) => typeof dir === "string" && dir.length > 0)
      .map((dir) => path.resolve(dir))
      // The root project's own test script is what invokes this file.
      .filter((dir) => dir !== root)
      .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
  );
}

function collectTestableProjects() {
  return listWorkspaceProjectDirs()
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
}

function runProjectTests() {
  const packages = collectTestableProjects();

  let tested = 0;
  let skipped = 0;

  for (const pkg of packages) {
    const isCompatible = supportsCurrentNode(pkg.nodeEngine);

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

  console.log(`\nTested ${tested} projects. Skipped ${skipped} projects.`);
}

if (require.main === module) {
  runProjectTests();
}

module.exports = { collectTestableProjects, listWorkspaceProjectDirs };
