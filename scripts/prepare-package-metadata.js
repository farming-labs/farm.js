const fs = require("node:fs");
const path = require("node:path");

const workspaceRoot = path.resolve(__dirname, "..");
const packagesRoot = path.join(workspaceRoot, "packages");
const repositoryUrl = "https://github.com/farming-labs/farm.js";

for (const directoryName of fs.readdirSync(packagesRoot).sort()) {
  const packageDirectory = path.join(packagesRoot, directoryName);
  const packageJsonPath = path.join(packageDirectory, "package.json");

  if (!fs.existsSync(packageJsonPath)) continue;

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (packageJson.private === true) continue;

  packageJson.repository = {
    type: "git",
    url: repositoryUrl,
    directory: `packages/${directoryName}`,
  };
  packageJson.publishConfig = {
    ...packageJson.publishConfig,
    access: "public",
  };

  fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const readmePath = path.join(packageDirectory, "README.md");
  if (fs.existsSync(readmePath)) continue;

  const description = packageJson.description || "A package in the Farm.js framework.";
  const installCommand =
    packageJson.name === "@farm.js/create-app"
      ? "npm create @farm.js/app@beta"
      : `npm install ${packageJson.name}@beta`;

  const readme = `# ${packageJson.name}

${description}

Farm.js is currently in beta.

\`\`\`bash
${installCommand}
\`\`\`

See the [Farm.js repository](${repositoryUrl}) for documentation, examples, and support.
`;

  fs.writeFileSync(readmePath, readme);
}

console.log("Prepared public package metadata and README files.");
