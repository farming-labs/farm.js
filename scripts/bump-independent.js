#!/usr/bin/env node
/**
 * Version independently released packages: public packages under packages/
 * whose manifests are not in bump.config.ts.
 *
 * Bumpp is the wrong tool for these. Run from the repository root it merges
 * bump.config.ts's file list into the command line and bumps the whole shared
 * group; run from inside the package directory with an explicit version it can
 * exit without changing anything. This script rewrites exactly one `version`
 * line per manifest and prints the change.
 *
 *   node scripts/bump-independent.js <package-dir|name> <version>
 *   node scripts/bump-independent.js --changed-since <git-ref>
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { readPublicPackages } = require("./public-packages.js");

const workspaceRoot = path.resolve(__dirname, "..");

const usage = `Usage:
  node scripts/bump-independent.js <package-dir|name> <version>
  node scripts/bump-independent.js --changed-since <git-ref>

The first form sets the version of one independently versioned package.
The second lists independent packages whose shipped files changed since <git-ref>.`;

// Files that change a package's repository directory without changing what
// users install from npm.
const unshippedPatterns = [
  /(^|\/)__tests__\//,
  /(^|\/)__snapshots__\//,
  /(^|\/)tests?\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.snap$/,
  /(^|\/)README(\.[^/]*)?$/i,
  /(^|\/)vitest\.config\.[cm]?[jt]s$/,
];

const semverPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?$/;

function toPosix(file) {
  return file.split(path.sep).join("/");
}

/** Package directories (relative, posix) whose manifests Bumpp versions together. */
function readSharedPackageDirs(root = workspaceRoot) {
  const source = fs.readFileSync(path.join(root, "bump.config.ts"), "utf8");
  const dirs = new Set();
  for (const match of source.matchAll(/["'`](packages\/[^"'`]+)\/package\.json["'`]/g)) {
    dirs.add(match[1]);
  }
  if (dirs.size === 0) {
    throw new Error("bump.config.ts lists no packages/*/package.json files.");
  }
  return dirs;
}

function readIndependentPackages(root = workspaceRoot) {
  const shared = readSharedPackageDirs(root);
  return readPublicPackages(root)
    .map((pkg) => ({ ...pkg, relativeDir: toPosix(path.relative(root, pkg.dir)) }))
    .filter((pkg) => !shared.has(pkg.relativeDir));
}

function resolvePackage(target, root = workspaceRoot) {
  const candidates = readPublicPackages(root).map((pkg) => ({
    ...pkg,
    relativeDir: toPosix(path.relative(root, pkg.dir)),
  }));
  const asPath = path.resolve(root, target);
  const asPackagesChild = path.join(root, "packages", target);
  const found = candidates.find(
    (pkg) => pkg.name === target || pkg.dir === asPath || pkg.dir === asPackagesChild,
  );
  if (!found) {
    throw new Error(`No public workspace package matches "${target}".`);
  }
  if (readSharedPackageDirs(root).has(found.relativeDir)) {
    throw new Error(
      `${found.name} is in the shared release group (bump.config.ts); release it with Bumpp instead.`,
    );
  }
  return found;
}

function compareIdentifiers(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) return Math.sign(Number(left) - Number(right));
  if (leftNumeric) return -1;
  if (rightNumeric) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

/** SemVer 2.0.0 precedence; build metadata is not accepted by this script. */
function compareVersions(left, right) {
  const a = semverPattern.exec(left);
  const b = semverPattern.exec(right);
  if (!a || !b) throw new Error(`Cannot compare "${left}" and "${right}".`);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Math.sign(Number(a[index]) - Number(b[index]));
    if (difference !== 0) return difference;
  }
  if (!a[4] || !b[4]) return a[4] ? -1 : b[4] ? 1 : 0;
  const leftParts = a[4].split(".");
  const rightParts = b[4].split(".");
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1;
    if (rightParts[index] === undefined) return 1;
    const difference = compareIdentifiers(leftParts[index], rightParts[index]);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The next prerelease of the same line: 0.1.0-beta.2 -> 0.1.0-beta.3. */
function suggestNextVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) return null;
  if (!match[4]) return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
  const parts = match[4].split(".");
  const last = parts.length - 1;
  if (/^\d+$/.test(parts[last])) parts[last] = String(Number(parts[last]) + 1);
  else parts.push("0");
  return `${match[1]}.${match[2]}.${match[3]}-${parts.join(".")}`;
}

function withoutVersion(manifest) {
  const { version: _version, ...rest } = manifest;
  return JSON.stringify(rest);
}

/** Rewrites the top-level version field only; every other byte is preserved. */
function rewriteVersion(source, nextVersion) {
  const manifest = JSON.parse(source);
  const versionLine = /^(\s*"version"\s*:\s*")([^"]*)(")/m;
  const match = versionLine.exec(source);
  if (!match || match[2] !== manifest.version) {
    throw new Error("Could not locate the top-level version field.");
  }
  const updated = source.replace(versionLine, `$1${nextVersion}$3`);
  const parsed = JSON.parse(updated);
  if (parsed.version !== nextVersion || withoutVersion(parsed) !== withoutVersion(manifest)) {
    throw new Error("Refusing to write: the edit touched more than the version field.");
  }
  return { updated, before: match[0], after: `${match[1]}${nextVersion}${match[3]}` };
}

function bumpPackage(target, nextVersion, root = workspaceRoot) {
  if (!semverPattern.test(nextVersion)) {
    throw new Error(`"${nextVersion}" is not a valid version such as 0.1.0-beta.3 or 0.1.0.`);
  }
  const pkg = resolvePackage(target, root);
  if (compareVersions(nextVersion, pkg.version) <= 0) {
    throw new Error(
      `${pkg.name} is already ${pkg.version}; the new version must be greater than it.`,
    );
  }
  const manifestPath = path.join(pkg.dir, "package.json");
  const source = fs.readFileSync(manifestPath, "utf8");
  const { updated, before, after } = rewriteVersion(source, nextVersion);
  fs.writeFileSync(manifestPath, updated);
  return {
    name: pkg.name,
    file: `${pkg.relativeDir}/package.json`,
    from: pkg.version,
    to: nextVersion,
    diff: [`--- a/${pkg.relativeDir}/package.json`, `+++ b/${pkg.relativeDir}/package.json`]
      .concat(`-${before}`, `+${after}`)
      .join("\n"),
  };
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function readFileAt(root, ref, file) {
  try {
    return git(root, ["show", `${ref}:${file}`]);
  } catch {
    return null;
  }
}

function isShippedChange(root, ref, file) {
  const name = file.split("/").slice(2).join("/");
  if (unshippedPatterns.some((pattern) => pattern.test(name))) return false;
  if (name !== "package.json") return true;
  // A manifest whose only change is the version line ships nothing new.
  const before = readFileAt(root, ref, file);
  const after = fs.existsSync(path.join(root, file))
    ? fs.readFileSync(path.join(root, file), "utf8")
    : null;
  if (before === null || after === null) return true;
  return withoutVersion(JSON.parse(before)) !== withoutVersion(JSON.parse(after));
}

/**
 * Independent packages with shipped-file changes between `ref` and the working
 * tree, with the version each had at `ref`.
 */
function listChangedSince(ref, root = workspaceRoot) {
  git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  const changed = git(root, ["diff", "--name-only", ref, "--", "packages/"])
    .split("\n")
    .filter(Boolean);
  return readIndependentPackages(root)
    .map((pkg) => {
      const prefix = `${pkg.relativeDir}/`;
      const files = changed
        .filter((file) => file.startsWith(prefix))
        .filter((file) => isShippedChange(root, ref, file));
      if (files.length === 0) return null;
      const previous = readFileAt(root, ref, `${pkg.relativeDir}/package.json`);
      const previousVersion = previous ? JSON.parse(previous).version : null;
      const bumped = previousVersion !== null && previousVersion !== pkg.version;
      return {
        name: pkg.name,
        dir: pkg.relativeDir,
        previousVersion,
        version: pkg.version,
        bumped,
        suggested: bumped ? null : suggestNextVersion(pkg.version),
        files,
      };
    })
    .filter(Boolean);
}

function formatChanged(ref, rows) {
  if (rows.length === 0) {
    return `No independently versioned package has shipped changes since ${ref}.`;
  }
  const lines = [`Independent packages with shipped changes since ${ref}:`, ""];
  for (const row of rows) {
    const state = row.bumped
      ? `already bumped ${row.previousVersion} -> ${row.version}`
      : `needs a bump from ${row.version}`;
    lines.push(`${row.name} (${row.dir}): ${state}`);
    for (const file of row.files) lines.push(`    ${file}`);
    if (!row.bumped && row.suggested) {
      lines.push(`  node scripts/bump-independent.js ${row.dir} ${row.suggested}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function main(args = process.argv.slice(2), root = workspaceRoot) {
  const positional = args.filter((arg) => arg !== "--");
  if (positional.length === 0 || positional.includes("--help") || positional.includes("-h")) {
    console.log(usage);
    return positional.length === 0 ? 1 : 0;
  }
  if (positional[0] === "--changed-since") {
    if (positional.length !== 2) throw new Error(usage);
    console.log(formatChanged(positional[1], listChangedSince(positional[1], root)));
    return 0;
  }
  if (positional.length !== 2 || positional.some((arg) => arg.startsWith("-"))) {
    throw new Error(usage);
  }
  const result = bumpPackage(positional[0], positional[1], root);
  console.log(result.diff);
  console.log(
    `\n${result.name}: ${result.from} -> ${result.to}. ` +
      "Run `node scripts/sync-release-versions.js` so starters follow it.",
  );
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  bumpPackage,
  compareVersions,
  listChangedSince,
  main,
  readIndependentPackages,
  readSharedPackageDirs,
  rewriteVersion,
  suggestNextVersion,
};
