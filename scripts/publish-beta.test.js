const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  assertPackagesBuilt,
  distTagForVersion,
  findMissingEntryFiles,
  manifestEntryFiles,
  findStableCoreDependencyMismatches,
  groupPackagesByDistTag,
  isMissingRegistryVersion,
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

test("only falls back to local metadata when the registry reports a missing version", () => {
  assert.equal(isMissingRegistryVersion({ stderr: "npm error E404 No match found" }), true);
  assert.equal(isMissingRegistryVersion({ stderr: "npm error ECONNRESET" }), false);
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
    { name: "@farm.js/core", version: "0.1.0", manifest: {} },
    { name: "@farm.js/otel", version: "0.1.0-beta.27", manifest: {} },
    { name: "@farm.js/vue", version: "0.1.0-beta.27", manifest: {} },
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

test("checks peer dependencies even when a stable runtime dependency is present", () => {
  const packages = [
    { name: "@farm.js/core", version: "0.1.0", manifest: {} },
    {
      name: "@farm.js/webmcp",
      version: "0.1.0-beta.0",
      manifest: {
        dependencies: { "@farm.js/core": "^0.1.0" },
        peerDependencies: { "@farm.js/core": "^0.1.0-beta.109" },
      },
    },
  ];

  assert.deepEqual(
    findStableCoreDependencyMismatches(packages, () => packages[1].manifest),
    [
      {
        package: "@farm.js/webmcp@0.1.0-beta.0",
        dependency: "^0.1.0-beta.109",
        stableCore: "0.1.0",
      },
    ],
  );
});

test("uses the local manifest before a beta version is visible on the registry", () => {
  const packages = [
    { name: "@farm.js/core", version: "0.1.0", manifest: {} },
    {
      name: "@farm.js/new-tool",
      version: "0.1.0-beta.0",
      manifest: { dependencies: { "@farm.js/core": "0.1.0-beta.109" } },
    },
  ];

  assert.deepEqual(
    findStableCoreDependencyMismatches(packages, (_name, _version, localManifest) => {
      if (!localManifest) throw new Error("not visible yet");
      return localManifest;
    }),
    [
      {
        package: "@farm.js/new-tool@0.1.0-beta.0",
        dependency: "0.1.0-beta.109",
        stableCore: "0.1.0",
      },
    ],
  );
});

test("lists every entry file a manifest promises, skipping export patterns", () => {
  assert.deepEqual(
    manifestEntryFiles({
      main: "./dist/index.cjs",
      types: "dist/index.d.ts",
      bin: { farm: "./bin/farm.js" },
      exports: {
        ".": { types: "./dist/index.d.ts", import: "./dist/index.js", "react-native": "./native.js" },
        "./client": "./dist/client.js",
        "./themes/*": "./themes/*.css",
      },
    }),
    ["bin/farm.js", "dist/client.js", "dist/index.cjs", "dist/index.d.ts", "dist/index.js", "native.js"],
  );
});

// @farm.js/ui@0.1.0-beta.2 shipped with native.js and no dist/: its build cleared dist/ and did
// not finish, and the publish uploaded what was left.
test("refuses to publish a package whose build output is missing", () => {
  const ui = {
    name: "@farm.js/ui",
    dir: "/repo/packages/farm-ui",
    manifest: {
      exports: {
        ".": {
          types: "./dist/index.d.ts",
          "react-native": "./native.js",
          import: "./dist/index.js",
          default: "./dist/index.js",
        },
      },
    },
  };
  const onDisk = new Set(["/repo/packages/farm-ui/native.js"]);
  const exists = (file) => onDisk.has(file);
  assert.deepEqual(findMissingEntryFiles([ui], exists), [
    { package: "@farm.js/ui", file: "dist/index.d.ts" },
    { package: "@farm.js/ui", file: "dist/index.js" },
  ]);
  assert.throws(
    () => assertPackagesBuilt([ui], exists),
    /entry files are missing[\s\S]*@farm\.js\/ui: dist\/index\.js/,
  );
  onDisk.add("/repo/packages/farm-ui/dist/index.js");
  onDisk.add("/repo/packages/farm-ui/dist/index.d.ts");
  assert.doesNotThrow(() => assertPackagesBuilt([ui], exists));
});
