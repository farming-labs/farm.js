const { execFileSync } = require("node:child_process");
const path = require("node:path");

const packageJson = require(path.resolve(__dirname, "../packages/create-farm-app/package.json"));
const packageSpec = `${packageJson.name}@${packageJson.version}`;
const dryRun = process.argv.includes("--dry-run");

if (!packageJson.version.includes("-beta.")) {
  throw new Error(`Refusing to promote non-beta package ${packageSpec}.`);
}

const distTags = JSON.parse(
  execFileSync("npm", ["view", packageJson.name, "dist-tags", "--json"], {
    encoding: "utf8",
  }),
);

if (distTags.beta !== packageJson.version) {
  throw new Error(
    `The beta tag points to ${distTags.beta ?? "nothing"}, not ${packageJson.version}. Publish the beta before promoting it.`,
  );
}

if (distTags.latest && !distTags.latest.includes("-")) {
  console.log(`Keeping stable latest tag at ${distTags.latest}.`);
  process.exit(0);
}

if (distTags.latest === packageJson.version) {
  console.log(`The latest tag already points to ${packageSpec}.`);
  process.exit(0);
}

if (dryRun) {
  console.log(`Would promote ${packageSpec} to the latest tag.`);
  process.exit(0);
}

execFileSync("npm", ["dist-tag", "add", packageSpec, "latest"], {
  stdio: "inherit",
});
