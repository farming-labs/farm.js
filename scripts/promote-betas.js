const { execFileSync } = require("node:child_process");
const { readPublicPackages } = require("./public-packages");

function readDistTags(packageName) {
  return JSON.parse(
    execFileSync("npm", ["view", packageName, "dist-tags", "--json"], {
      encoding: "utf8",
    }),
  );
}

/**
 * Decide which beta versions to promote to `latest`.
 *
 * Stable versions are published straight to `latest`, so they are only
 * checked. A package that already has a stable `latest` keeps it: betas never
 * replace a stable release.
 */
function planPromotions(packages, getDistTags = readDistTags) {
  const promotions = [];
  const messages = [];
  const validationErrors = [];

  for (const { name, version } of packages) {
    const packageSpec = `${name}@${version}`;
    const isStable = !version.includes("-");

    if (!isStable && !version.includes("-beta.")) {
      validationErrors.push(`Refusing to promote non-beta prerelease ${packageSpec}.`);
      continue;
    }

    let distTags;
    try {
      distTags = getDistTags(name);
    } catch {
      validationErrors.push(`Could not read npm dist-tags for ${packageSpec}. Publish it first.`);
      continue;
    }

    if (isStable) {
      if (distTags.latest === version) {
        messages.push(`Stable ${packageSpec} is already the latest tag.`);
      } else {
        validationErrors.push(
          `The latest tag for ${name} points to ${distTags.latest ?? "nothing"}, not stable ${version}. Publish it first.`,
        );
      }
      continue;
    }

    if (distTags.latest && !distTags.latest.includes("-")) {
      messages.push(`Keeping stable latest tag at ${name}@${distTags.latest}.`);
      continue;
    }

    if (distTags.latest === version) {
      messages.push(`The latest tag already points to ${packageSpec}.`);
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

  return { promotions, messages, validationErrors };
}

function main(args = process.argv.slice(2)) {
  const dryRun = args.includes("--dry-run");
  const { promotions, messages, validationErrors } = planPromotions(readPublicPackages());
  for (const message of messages) console.log(message);

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
}

if (require.main === module) {
  main();
}

module.exports = { planPromotions };
