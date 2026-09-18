const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");
const packagesRoot = path.join(workspaceRoot, "packages");
const templatesRoot = path.join(workspaceRoot, "packages/create-farm-app/templates");
const standalonePackages = [
  {
    label: "StackBlitz example",
    packagePath: path.join(workspaceRoot, "examples/stackblitz/package.json"),
  },
];

const workspaceVersions = new Map();

function findTemplatePackageFiles(directory) {
  const packageFiles = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      packageFiles.push(...findTemplatePackageFiles(entryPath));
    } else if (entry.name === "package.json") {
      packageFiles.push(entryPath);
    }
  }

  return packageFiles;
}

for (const directoryName of fs.readdirSync(packagesRoot).sort()) {
  const packageJsonPath = path.join(packagesRoot, directoryName, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name && packageJson.version) {
    workspaceVersions.set(packageJson.name, packageJson.version);
  }
}

function syncPackageVersions(packagePath, label) {
  const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  const syncedPackages = [];

  for (const dependencyGroup of ["dependencies", "devDependencies"]) {
    for (const packageName of Object.keys(packageJson[dependencyGroup] ?? {})) {
      const workspaceVersion = workspaceVersions.get(packageName);
      if (!workspaceVersion) continue;

      packageJson[dependencyGroup][packageName] = workspaceVersion;
      syncedPackages.push(`${packageName}@${workspaceVersion}`);
    }
  }

  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  console.log(`Synced ${label}: ${syncedPackages.join(", ")}`);
}

for (const templatePackagePath of findTemplatePackageFiles(templatesRoot).sort()) {
  const templateName = path.relative(templatesRoot, path.dirname(templatePackagePath));
  syncPackageVersions(templatePackagePath, `${templateName} template`);
}

for (const { label, packagePath } of standalonePackages) {
  syncPackageVersions(packagePath, label);
}
