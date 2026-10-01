const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  distTagForVersion,
  findStableCoreDependencyMismatches,
  groupPackagesByDistTag,
  isRetryableStagedPublishError,
  parsePublishBetaArgs,
  publishArgs,
} = require("./publish-beta");

test("publishes and verifies by default", () => {
  assert.deepEqual(parsePublishBetaArgs([]), { help: false, verifyOnly: false, dryRun: false });
});

test("supports resuming with --verify-only", () => {
  assert.deepEqual(parsePublishBetaArgs(["--verify-only"]), {
    help: false,
    verifyOnly: true,
    dryRun: false,
  });
});

test("supports a non-publishing dry run", () => {
  assert.deepEqual(parsePublishBetaArgs(["--dry-run"]), {
    help: false,
    verifyOnly: false,
    dryRun: true,
  });
});

test("rejects combining dry run and verification", () => {
  assert.throws(
    () => parsePublishBetaArgs(["--dry-run", "--verify-only"]),
    /cannot combine --verify-only and --dry-run/,
  );
});

test("rejects unknown options", () => {
  assert.throws(() => parsePublishBetaArgs(["--force"]), /Unknown publish:beta option/);
});

test("treats staged-version conflicts as retryable", () => {
  assert.ok(
    isRetryableStagedPublishError(
      'npm error 409 Conflict - PUT https://registry.npmjs.org/@farm.js%2fauth - Cannot publish over previously staged version "0.1.0-beta.53".',
    ),
  );
  assert.ok(isRetryableStagedPublishError("npm error code E409"));
  // The registry reports an accepted-but-unpropagated version as a 403 on
  // republish; observed on the v0.1.0-beta.54 release.
  assert.ok(
    isRetryableStagedPublishError(
      "npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@farm.js%2fauth - You cannot publish over the previously published versions: 0.1.0-beta.54.",
    ),
  );
});

test("does not retry unrelated publish failures", () => {
  assert.equal(isRetryableStagedPublishError("npm error code E403 Forbidden"), false);
  assert.equal(isRetryableStagedPublishError("npm error code ENEEDAUTH"), false);
  assert.equal(
    isRetryableStagedPublishError("npm error 404 Not Found - PUT https://registry.npmjs.org/x"),
    false,
  );
});

test("derives each package's dist-tag from its version", () => {
  assert.equal(distTagForVersion("0.1.0"), "latest");
  assert.equal(distTagForVersion("1.2.3"), "latest");
  assert.equal(distTagForVersion("0.1.0-beta.108"), "beta");
  assert.equal(distTagForVersion("0.1.1-beta.0"), "beta");
  assert.equal(distTagForVersion("0.2.0-canary.4"), "canary");
});

test("publishes a stable shared group next to independent betas", () => {
  const groups = groupPackagesByDistTag([
    { name: "@farm.js/core", version: "0.1.0", dir: "/w/packages/farm" },
    { name: "@farm.js/vue", version: "0.1.0-beta.29", dir: "/w/packages/farm-vue" },
    { name: "@farm.js/cli", version: "0.1.0", dir: "/w/packages/farm-cli" },
  ]);
  assert.deepEqual([...groups.keys()], ["latest", "beta"]);
  assert.deepEqual(publishArgs(groups.get("latest"), "latest", ["--dry-run"]), [
    "-r",
    "--filter",
    "@farm.js/core",
    "--filter",
    "@farm.js/cli",
    "publish",
    "--access",
    "public",
    "--tag",
    "latest",
    "--publish-branch",
    "main",
    "--dry-run",
  ]);
  assert.deepEqual(
    groups.get("beta").map((pkg) => pkg.name),
    ["@farm.js/vue"],
  );
});

test("detects beta packages that still resolve a prerelease core", () => {
  const packages = [
    { name: "@farm.js/core", version: "0.1.0" },
    { name: "@farm.js/otel", version: "0.1.0-beta.27" },
    { name: "@farm.js/vue", version: "0.1.0-beta.27" },
  ];
  const manifests = {
    "@farm.js/otel": { dependencies: { "@farm.js/core": "0.1.0-beta.109" } },
    "@farm.js/vue": { peerDependencies: { "@farm.js/core": "^0.1.0-beta.109" } },
  };
  assert.deepEqual(
    findStableCoreDependencyMismatches(packages, (name) => manifests[name]),
    [
      {
        package: "@farm.js/otel@0.1.0-beta.27",
        dependency: "0.1.0-beta.109",
        stableCore: "0.1.0",
      },
      {
        package: "@farm.js/vue@0.1.0-beta.27",
        dependency: "^0.1.0-beta.109",
        stableCore: "0.1.0",
      },
    ],
  );
});
