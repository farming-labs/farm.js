const assert = require("node:assert/strict");
const { test } = require("node:test");

const { parsePublishBetaArgs, isRetryableStagedPublishError } = require("./publish-beta");

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
