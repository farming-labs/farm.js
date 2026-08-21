/**
 * Publish every public workspace package to the beta dist-tag, verify each
 * version is actually visible on the registry, and only then promote betas.
 *
 * The npm registry occasionally leaves a publish in a "staged" state: the
 * publish command reports success, but the version is not installable and
 * re-publishing fails with `E409 Cannot publish over previously staged
 * version` until the registry finalizes it (observed repeatedly for the same
 * trailing packages during v0.1.0-beta.52/53). This script absorbs that by
 * polling for visibility and retrying stragglers before promotion.
 *
 * Usage: node scripts/publish-beta.js [--verify-only] [--help]
 *   --verify-only  Skip the initial bulk publish and only verify, retry
 *                  stragglers, and promote. Useful to resume after a failure.
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");
const packagesRoot = path.join(workspaceRoot, "packages");

const VERIFY_ATTEMPTS = 30;
const VERIFY_DELAY_MS = 30_000;

const supportedFlags = new Set(["--help", "--verify-only"]);
const helpText = `Usage: node scripts/publish-beta.js [--verify-only]

Options:
  --verify-only  Skip the bulk publish; verify registry visibility, retry
                 staged packages, and promote betas.`;

function parsePublishBetaArgs(args) {
  const unknownFlags = args.filter((arg) => !supportedFlags.has(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown publish:beta option(s): ${unknownFlags.join(", ")}`);
  }
  return {
    help: args.includes("--help"),
    verifyOnly: args.includes("--verify-only"),
  };
}

/**
 * A publish the registry has accepted but not yet made visible surfaces on
 * retry as either a 409 ("previously staged version") or a 403 ("cannot
 * publish over the previously published versions"). Both mean the version
 * will appear once the registry finishes propagating, so the failure is
 * retryable by waiting; other 403s (auth, policy) are not matched.
 */
function isRetryableStagedPublishError(output) {
  return /previously staged version|previously published versions|E409|409 Conflict/i.test(output);
}

function readPublicPackages() {
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      dir: path.join(packagesRoot, entry.name),
      packageJsonPath: path.join(packagesRoot, entry.name, "package.json"),
    }))
    .filter(({ packageJsonPath }) => fs.existsSync(packageJsonPath))
    .map(({ dir, packageJsonPath }) => ({
      dir,
      ...JSON.parse(fs.readFileSync(packageJsonPath, "utf8")),
    }))
    .filter((packageJson) => packageJson.name && packageJson.version && !packageJson.private)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, {
    cwd: workspaceRoot,
    stdio: "inherit",
    ...options,
  });
}

function isVersionVisible(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function tryPublishPackage(pkg) {
  try {
    execFileSync(
      "pnpm",
      ["publish", "--access", "public", "--tag", "beta", "--publish-branch", "main"],
      { cwd: pkg.dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    console.log(`Republished ${pkg.name}@${pkg.version}.`);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    if (isRetryableStagedPublishError(output)) {
      console.log(
        `${pkg.name}@${pkg.version} is staged on the registry; waiting for it to finalize.`,
      );
      return;
    }
    throw new Error(`Failed to republish ${pkg.name}@${pkg.version}:\n${output}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function verifyAndRetryPublishes(packages) {
  let missing = packages;
  for (let attempt = 1; attempt <= VERIFY_ATTEMPTS; attempt += 1) {
    missing = missing.filter((pkg) => !isVersionVisible(pkg.name, pkg.version));
    if (missing.length === 0) return;

    console.log(
      `${missing.length} package(s) not yet visible on the registry (attempt ${attempt}/${VERIFY_ATTEMPTS}): ${missing
        .map((pkg) => pkg.name)
        .join(", ")}`,
    );
    for (const pkg of missing) {
      tryPublishPackage(pkg);
    }
    if (attempt < VERIFY_ATTEMPTS) await sleep(VERIFY_DELAY_MS);
  }

  missing = missing.filter((pkg) => !isVersionVisible(pkg.name, pkg.version));
  if (missing.length > 0) {
    throw new Error(
      [
        `Timed out waiting for ${missing.length} package(s) to become visible on the registry:`,
        ...missing.map((pkg) => `- ${pkg.name}@${pkg.version}`),
        "Once the registry finalizes them, resume with: node scripts/publish-beta.js --verify-only",
      ].join("\n"),
    );
  }
}

async function main(args = process.argv.slice(2)) {
  const options = parsePublishBetaArgs(args);
  if (options.help) {
    console.log(helpText);
    return;
  }

  const packages = readPublicPackages();
  if (packages.length === 0) {
    throw new Error("No public packages found under packages/.");
  }

  if (!options.verifyOnly) {
    try {
      run("pnpm", [
        "-r",
        "--filter",
        "./packages/*",
        "publish",
        "--access",
        "public",
        "--tag",
        "beta",
        "--publish-branch",
        "main",
      ]);
    } catch {
      // A partial bulk publish is recoverable: verification below finds the
      // gaps and retries them individually.
      console.warn("Bulk publish exited with an error; verifying per-package state.");
    }
  }

  await verifyAndRetryPublishes(packages);
  run("pnpm", ["run", "dist-tags:promote-betas"]);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { parsePublishBetaArgs, isRetryableStagedPublishError };
