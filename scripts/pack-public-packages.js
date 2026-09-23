const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readPublicPackages } = require("./public-packages");

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

module.exports = { packPublicPackages };
