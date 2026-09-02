const { execFileSync } = require("node:child_process");
const { readPublicPackages } = require("./public-packages");

const dryRun = process.argv.includes("--dry-run");

function readDistTags(packageName) {
  return JSON.parse(
    execFileSync("npm", ["view", packageName, "dist-tags", "--json"], {
      encoding: "utf8",
    }),
  );
}

const promotions = [];
const validationErrors = [];

for (const packageJson of readPublicPackages()) {
  const { name, version } = packageJson;
  const packageSpec = `${name}@${version}`;

  if (!version.includes("-beta.")) {
    validationErrors.push(`Refusing to promote non-beta package ${packageSpec}.`);
    continue;
  }

  let distTags;
  try {
    distTags = readDistTags(name);
  } catch {
    validationErrors.push(`Could not read npm dist-tags for ${packageSpec}. Publish it first.`);
    continue;
  }

  if (distTags.latest && !distTags.latest.includes("-")) {
    console.log(`Keeping stable latest tag at ${name}@${distTags.latest}.`);
    continue;
  }

  if (distTags.latest === version) {
    console.log(`The latest tag already points to ${packageSpec}.`);
    continue;
  }

  if (distTags.beta !== version) {
    validationErrors.push(
      `The beta tag for ${name} points to ${distTags.beta ?? "nothing"}, not ${version}. Publish the beta first.`,
    );
    continue;
  }

  promotions.push(packageSpec);
}

if (validationErrors.length > 0) {
  throw new Error(`Beta promotion validation failed:\n- ${validationErrors.join("\n- ")}`);
}

for (const packageSpec of promotions) {
  if (dryRun) {
    console.log(`Would promote ${packageSpec} to the latest tag.`);
    continue;
  }

  execFileSync("npm", ["dist-tag", "add", packageSpec, "latest"], {
    stdio: "inherit",
  });
}

console.log(
  promotions.length === 0
    ? "All public beta packages already have the intended latest tag."
    : `${dryRun ? "Would promote" : "Promoted"} ${promotions.length} beta package(s) to latest.`,
);
