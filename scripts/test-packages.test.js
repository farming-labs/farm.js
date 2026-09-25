const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { collectTestableProjects, listWorkspaceProjectDirs } = require("./test-packages");

const root = path.resolve(__dirname, "..");

test("collects workspace projects outside packages/, not only packages/*", () => {
  // This script used to walk packages/ alone, and no workflow ran anything
  // else, so tests under docs/ and examples/ never executed. Five docs test
  // files covering telemetry origin attestation, dashboard session expiry, and
  // waitlist rate limiting read as coverage that did not exist.
  const names = collectTestableProjects().map((project) => project.name);

  assert.ok(names.includes("farmjs-docs"), "docs must be in the test sweep");
  assert.ok(
    names.some((name) => name.includes("stripe-prisma-org")),
    "a nested example project with tests must be in the test sweep",
  );
});

test("finds projects nested more than one level deep", () => {
  // examples/stripe-integrations/prisma-org sits two levels down, so a
  // single-level readdir would miss it.
  const dirs = listWorkspaceProjectDirs();
  const nested = dirs.filter((dir) => {
    const relative = path.relative(root, dir);
    return relative.split(path.sep).length > 2;
  });

  assert.ok(nested.length > 0, "expected at least one nested workspace project");
});

test("never includes the repository root", () => {
  // The root's own test script is what runs this sweep, so including it would
  // recurse forever.
  assert.ok(!listWorkspaceProjectDirs().includes(root));
});

test("every collected project actually declares a test script", () => {
  for (const project of collectTestableProjects()) {
    const pkg = JSON.parse(fs.readFileSync(path.join(project.dir, "package.json"), "utf8"));
    assert.ok(pkg.scripts?.test, `${project.name} should declare a test script`);
  }
});
