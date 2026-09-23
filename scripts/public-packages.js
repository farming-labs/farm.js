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
        ? { dir, name: manifest.name, version: manifest.version }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name));
}

module.exports = { readPublicPackages };
