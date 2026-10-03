const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readPublicPackages } = require("./public-packages");

const repositoryRoot = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const targetPackageNames = [
  "@farm.js/authjs",
  "@farm.js/stripe",
  "@farm.js/jobs",
  "@farm.js/clerk",
];
const supportPackageNames = ["@farm.js/core", "@farm.js/integration-utils"];

function readManifest(directory) {
  return JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
}

function packageExportSpecifiers(manifest) {
  return Object.keys(manifest.exports || {})
    .filter((key) => key === "." || (key.startsWith("./") && !key.includes("*")))
    .map((key) => (key === "." ? manifest.name : `${manifest.name}/${key.slice(2)}`));
}

function exportTarget(value, condition) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = exportTarget(candidate, condition);
      if (target) return target;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  return exportTarget(value[condition] ?? value.default, condition);
}

function packPackage(pkg, archiveDirectory) {
  const before = new Set(fs.readdirSync(archiveDirectory));
  try {
    execFileSync(pnpm, ["pack", "--pack-destination", archiveDirectory], {
      cwd: pkg.dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`Could not pack ${pkg.name}${details ? `:\n${details}` : "."}`, {
      cause: error,
    });
  }
  const archives = fs
    .readdirSync(archiveDirectory)
    .filter((file) => file.endsWith(".tgz") && !before.has(file));
  if (archives.length !== 1) {
    throw new Error(
      `Packing ${pkg.name} produced ${archives.length} new archives; expected exactly one.`,
    );
  }
  return path.join(archiveDirectory, archives[0]);
}

function fileDependency(filePath) {
  return `file:${filePath.replaceAll(path.sep, "/")}`;
}

function collectRequiredPeers(targets) {
  const peers = {};
  for (const { manifest } of targets) {
    for (const [name, range] of Object.entries(manifest.peerDependencies || {})) {
      if (manifest.peerDependenciesMeta?.[name]?.optional) continue;
      if (supportPackageNames.includes(name) || targetPackageNames.includes(name)) continue;
      if (peers[name] && peers[name] !== range) {
        throw new Error(
          `Packed integration peer range conflict for ${name}: ${peers[name]} versus ${range}.`,
        );
      }
      peers[name] = range;
    }
  }
  return peers;
}

function writeFixture(fixtureDirectory, packedPackages, targets) {
  const rootManifest = readManifest(repositoryRoot);
  const coreManifest = readManifest(path.join(repositoryRoot, "packages", "farm"));
  const dependencies = Object.fromEntries(
    [...packedPackages.entries()].map(([name, archive]) => [name, fileDependency(archive)]),
  );
  Object.assign(dependencies, collectRequiredPeers(targets), {
    "@types/node": rootManifest.devDependencies["@types/node"],
    "@types/react": coreManifest.devDependencies["@types/react"],
    react: coreManifest.devDependencies.react,
    "react-dom": coreManifest.devDependencies["react-dom"],
    typescript: rootManifest.devDependencies.typescript,
  });

  fs.writeFileSync(
    path.join(fixtureDirectory, "package.json"),
    `${JSON.stringify(
      {
        name: "farm-packed-integration-smoke",
        private: true,
        type: "module",
        packageManager: rootManifest.packageManager,
        dependencies,
        // Transitive Farm dependencies (an integration's dependency on core,
        // for example) must also resolve to the packed archives. Without this
        // pnpm fetches them from npm, which fails before the version is
        // published and otherwise tests the registry copy instead.
        pnpm: {
          overrides: Object.fromEntries(
            [...packedPackages.entries()].map(([name, archive]) => [name, fileDependency(archive)]),
          ),
        },
      },
      null,
      2,
    )}\n`,
  );

  const specifiers = targets.flatMap(({ manifest }) => packageExportSpecifiers(manifest));
  const typeImports = specifiers.map(
    (specifier, index) => `import * as Entry${index} from ${JSON.stringify(specifier)};`,
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, "smoke.ts"),
    `${typeImports.join("\n")}\n\nexport type PackedEntryExports = [${specifiers
      .map((_, index) => `keyof typeof Entry${index}`)
      .join(", ")}];\n`,
  );
  fs.writeFileSync(
    path.join(fixtureDirectory, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          lib: ["ES2022", "DOM", "DOM.Iterable"],
          strict: true,
          noEmit: true,
          // Export targets are checked directly below. Avoid requiring every optional
          // adapter referenced by third-party declaration files in this minimal fixture.
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["smoke.ts"],
      },
      null,
      2,
    )}\n`,
  );

  const requiredPeers = Object.keys(collectRequiredPeers(targets));
  fs.writeFileSync(
    path.join(fixtureDirectory, "runtime-smoke.mjs"),
    `const entries = ${JSON.stringify(specifiers)};
const peers = ${JSON.stringify(requiredPeers)};

for (const specifier of entries) {
  try {
    const loaded = await import(specifier);
    if (Object.keys(loaded).length === 0) throw new Error("module has no runtime exports");
    console.log("runtime import ok:", specifier);
  } catch (error) {
    throw new Error("Runtime import failed for " + specifier, { cause: error });
  }
}

for (const peer of peers) {
  try {
    import.meta.resolve(peer);
    console.log("peer resolved:", peer);
  } catch (error) {
    throw new Error("Required peer did not resolve for " + peer, { cause: error });
  }
}
`,
  );
}

function assertInstalledManifests(fixtureDirectory, packageNames) {
  for (const name of packageNames) {
    const manifestPath = path.join(
      fixtureDirectory,
      "node_modules",
      ...name.split("/"),
      "package.json",
    );
    if (!fs.existsSync(manifestPath)) {
      throw new Error(`Packed package ${name} was not installed at ${manifestPath}.`);
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
      for (const [dependency, range] of Object.entries(manifest[field] || {})) {
        if (typeof range === "string" && range.startsWith("workspace:")) {
          throw new Error(`${name} still publishes ${field}.${dependency} as ${range}.`);
        }
      }
    }

    if (!targetPackageNames.includes(name)) continue;
    for (const [entrypoint, value] of Object.entries(manifest.exports || {})) {
      if (entrypoint !== "." && (!entrypoint.startsWith("./") || entrypoint.includes("*"))) {
        continue;
      }
      const types = exportTarget(value, "types");
      if (!types) {
        throw new Error(`${name} export ${entrypoint} has no published types target.`);
      }
      const typesPath = path.resolve(path.dirname(manifestPath), types);
      if (!fs.existsSync(typesPath)) {
        throw new Error(
          `${name} export ${entrypoint} points to missing packed declarations at ${types}.`,
        );
      }
    }
  }
}

function runSmoke() {
  const publicPackages = new Map(readPublicPackages(repositoryRoot).map((pkg) => [pkg.name, pkg]));
  const packageNames = [...supportPackageNames, ...targetPackageNames];
  const missing = packageNames.filter((name) => !publicPackages.has(name));
  if (missing.length) throw new Error(`Public package(s) not found: ${missing.join(", ")}.`);

  const targets = targetPackageNames.map((name) => {
    const pkg = publicPackages.get(name);
    return { ...pkg, manifest: readManifest(pkg.dir) };
  });
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-packed-integration-smoke-"));
  const archiveDirectory = path.join(temporaryRoot, "archives");
  const fixtureDirectory = path.join(temporaryRoot, "fixture");
  fs.mkdirSync(archiveDirectory);
  fs.mkdirSync(fixtureDirectory);

  try {
    const packedPackages = new Map();
    for (const name of packageNames) {
      const pkg = publicPackages.get(name);
      console.log(`Packing ${name}@${pkg.version}...`);
      packedPackages.set(name, packPackage(pkg, archiveDirectory));
    }
    writeFixture(fixtureDirectory, packedPackages, targets);

    console.log("Installing packed artifacts in an isolated fixture...");
    execFileSync(
      pnpm,
      ["install", "--ignore-scripts", "--strict-peer-dependencies", "--no-frozen-lockfile"],
      { cwd: fixtureDirectory, stdio: "inherit" },
    );
    assertInstalledManifests(fixtureDirectory, packageNames);

    console.log("Type-checking published declarations...");
    execFileSync(
      process.execPath,
      [path.join(fixtureDirectory, "node_modules", "typescript", "bin", "tsc"), "--noEmit"],
      {
        cwd: fixtureDirectory,
        stdio: "inherit",
      },
    );

    console.log("Importing published runtime entry points...");
    execFileSync(process.execPath, ["runtime-smoke.mjs"], {
      cwd: fixtureDirectory,
      stdio: "inherit",
    });
    console.log(`Packed integration smoke passed for ${targetPackageNames.join(", ")}.`);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (require.main === module) runSmoke();

module.exports = {
  assertInstalledManifests,
  collectRequiredPeers,
  exportTarget,
  packageExportSpecifiers,
  runSmoke,
};
