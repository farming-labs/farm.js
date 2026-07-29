const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");
const corePackagePath = path.join(workspaceRoot, "packages/farm/package.json");
const templatePackagePath = path.join(
  workspaceRoot,
  "packages/create-farm-app/templates/basic/package.json",
);

const corePackage = JSON.parse(fs.readFileSync(corePackagePath, "utf8"));
const templatePackage = JSON.parse(fs.readFileSync(templatePackagePath, "utf8"));

templatePackage.dependencies["@farm.js/core"] = corePackage.version;

fs.writeFileSync(templatePackagePath, `${JSON.stringify(templatePackage, null, 2)}\n`);

console.log(`Synced starter template to @farm.js/core@${corePackage.version}`);
