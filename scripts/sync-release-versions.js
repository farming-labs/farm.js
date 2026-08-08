const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");
const packagesRoot = path.join(workspaceRoot, "packages");
const templatesRoot = path.join(workspaceRoot, "packages/create-farm-app/templates");

const workspaceVersions = new Map();

for (const directoryName of fs.readdirSync(packagesRoot).sort()) {
  const packageJsonPath = path.join(packagesRoot, directoryName, "package.json");
  if (!fs.existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.name && packageJson.version) {
    workspaceVersions.set(packageJson.name, packageJson.version);
  }
}

for (const templateName of fs.readdirSync(templatesRoot).sort()) {
  const templatePackagePath = path.join(templatesRoot, templateName, "package.json");
  if (!fs.existsSync(templatePackagePath)) continue;

  const templatePackage = JSON.parse(fs.readFileSync(templatePackagePath, "utf8"));
  const syncedPackages = [];

  for (const dependencyGroup of ["dependencies", "devDependencies"]) {
    for (const packageName of Object.keys(templatePackage[dependencyGroup] ?? {})) {
      const workspaceVersion = workspaceVersions.get(packageName);
      if (!workspaceVersion) continue;

      templatePackage[dependencyGroup][packageName] = workspaceVersion;
      syncedPackages.push(`${packageName}@${workspaceVersion}`);
    }
  }

  fs.writeFileSync(templatePackagePath, `${JSON.stringify(templatePackage, null, 2)}\n`);
  console.log(`Synced ${templateName} template: ${syncedPackages.join(", ")}`);
}
