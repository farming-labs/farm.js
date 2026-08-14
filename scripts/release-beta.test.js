const assert = require("node:assert/strict");
const { test } = require("node:test");

const { getReleasePlan } = require("./release-beta");

test("runs the checked beta preparation once by default", () => {
  assert.deepEqual(getReleasePlan([]), {
    help: false,
    commands: [
      ["pnpm", ["exec", "bumpp", "--preid", "beta", "--execute", "pnpm run release:prepare"]],
      ["pnpm", ["run", "publish:beta"]],
    ],
  });
});

test("keeps the build but skips tests when requested", () => {
  assert.deepEqual(getReleasePlan(["--no-test"]), {
    help: false,
    commands: [
      [
        "pnpm",
        ["exec", "bumpp", "--preid", "beta", "--execute", "pnpm run release:prepare:no-test"],
      ],
      ["pnpm", ["run", "publish:beta"]],
    ],
  });
});

test("rejects unknown beta release options", () => {
  assert.throws(() => getReleasePlan(["--skip-build"]), /Unknown beta release option/);
});
