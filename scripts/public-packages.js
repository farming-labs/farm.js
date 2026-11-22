const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");

function readPublicPackages(root = workspaceRoot) {
  const packagesRoot = path.join(root, "packages");
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => {
      const dir = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(dir, "package.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return manifest.name && manifest.version && !manifest.private
        ? { dir, name: manifest.name, version: manifest.version, manifest }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

const coreName = "@farm.js/core";

// The CLI runs the app's build, so it ships in the shared release group with an exact core.
const exactCoreDependents = new Set(["@farm.js/cli"]);

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareReleases(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Packages that would install a second core, or refuse the next core minor.
 *
 * A `workspace:*` dependency publishes as the exact core it was released with, so an app on a newer
 * core gets a nested copy per package. A peer range has to accept the next minor, or every package
 * not republished for that release fails to install with npm once it ships.
 */
function findCoreDependencyProblems(packages) {
  const core = packages.find((pkg) => pkg.name === coreName);
  const current = core && parseVersion(core.version);
  if (!current) throw new Error(`Cannot read the ${coreName} workspace version.`);
  const nextMinor = [current[0], current[1] + 1, 0];
  const nextMinorLabel = nextMinor.join(".");

  const problems = [];
  for (const { name, manifest } of packages) {
    if (name === coreName || exactCoreDependents.has(name)) continue;
    for (const field of ["dependencies", "optionalDependencies"]) {
      if (manifest[field]?.[coreName]) {
        problems.push(
          `${name}: move ${coreName} from \`${field}\` to \`peerDependencies\` (with \`workspace:*\` in \`devDependencies\`).`,
        );
      }
    }
    const range = manifest.peerDependencies?.[coreName];
    if (range === undefined) continue;
    if (manifest.devDependencies?.[coreName] !== "workspace:*") {
      problems.push(`${name}: add \`"${coreName}": "workspace:*"\` to \`devDependencies\`.`);
    }
    const bounds = /^>=(\S+) <(\S+)$/.exec(range);
    const floor = bounds && parseVersion(bounds[1]);
    const ceiling = bounds && parseVersion(bounds[2]);
    if (!floor || !ceiling) {
      problems.push(
        `${name}: write the ${coreName} peer as \`>=<floor> <<ceiling>\`, not \`${range}\`.`,
      );
      continue;
    }
    if (compareReleases(floor, current) > 0) {
      problems.push(
        `${name}: the ${coreName} peer \`${range}\` excludes the workspace core ${core.version}.`,
      );
    }
    if (compareReleases(ceiling, nextMinor) <= 0) {
      problems.push(
        `${name}: the ${coreName} peer \`${range}\` refuses core ${nextMinorLabel}; raise its upper bound past ${nextMinorLabel}.`,
      );
    }
  }
  return problems;
}

module.exports = { findCoreDependencyProblems, readPublicPackages };
