const { execFileSync } = require("node:child_process");

const supportedFlags = new Set(["--help", "--no-test"]);
const helpText = `Usage: pnpm release:beta [--no-test]

Options:
  --no-test  Build and publish the beta without running the test suite.`;

function run(command, commandArgs) {
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

function getReleasePlan(args) {
  const unknownFlags = args.filter((arg) => !supportedFlags.has(arg));
  if (unknownFlags.length > 0) {
    throw new Error(`Unknown beta release option(s): ${unknownFlags.join(", ")}`);
  }

  if (args.includes("--help")) {
    return { help: true, commands: [] };
  }

  const prepareScript = args.includes("--no-test") ? "release:prepare:no-test" : "release:prepare";

  return {
    help: false,
    commands: [
      ["pnpm", ["exec", "bumpp", "--preid", "beta", "--execute", `pnpm run ${prepareScript}`]],
      ["pnpm", ["run", "publish:beta"]],
    ],
  };
}

function main(args = process.argv.slice(2)) {
  const plan = getReleasePlan(args);
  if (plan.help) {
    console.log(helpText);
    return;
  }

  for (const [command, commandArgs] of plan.commands) {
    run(command, commandArgs);
  }
}

if (require.main === module) {
  main();
}

module.exports = { getReleasePlan };
