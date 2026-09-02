const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");

function readPublicPackages(root = workspaceRoot) {
  const packagesRoot = path.join(root, "packages");
  return fs
    .readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = path.join(packagesRoot, entry.name);
      const manifestPath = path.join(dir, "package.json");
      if (!fs.existsSync(manifestPath)) return null;
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      return manifest.name && manifest.version && manifest.private !== true
        ? { dir, name: manifest.name, version: manifest.version }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function packPublicPackages(options = {}) {
  const packages = options.packages ?? readPublicPackages(options.root);
  const run = options.run ?? execFileSync;
  if (packages.length === 0) {
    throw new Error("No public packages found under packages/.");
  }

  const packDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "farm-package-dry-run-"));
  try {
    for (const pkg of packages) {
      console.log(`Packing ${pkg.name}@${pkg.version}...`);
      run("pnpm", ["pack", "--pack-destination", packDirectory], {
        cwd: pkg.dir,
        stdio: "inherit",
      });
    }

    const archives = fs.readdirSync(packDirectory).filter((file) => file.endsWith(".tgz"));
    if (archives.length !== packages.length) {
      throw new Error(
        `Expected ${packages.length} package archive(s), but pnpm produced ${archives.length}.`,
      );
    }
    console.log(`Packed ${archives.length} public package(s) successfully.`);
  } finally {
    fs.rmSync(packDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  packPublicPackages();
}

module.exports = { packPublicPackages, readPublicPackages };
