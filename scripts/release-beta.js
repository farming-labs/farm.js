const { execFileSync } = require("node:child_process");

const args = process.argv.slice(2);
const supportedFlags = new Set(["--help", "--no-test"]);
const unknownFlags = args.filter((arg) => !supportedFlags.has(arg));

if (unknownFlags.length > 0) {
  throw new Error(`Unknown beta release option(s): ${unknownFlags.join(", ")}`);
}

if (args.includes("--help")) {
  console.log(`Usage: pnpm release:beta [--no-test]

Options:
  --no-test  Build and publish the beta without running the test suite.`);
  process.exit(0);
}

const skipTests = args.includes("--no-test");

function run(command, commandArgs) {
  execFileSync(command, commandArgs, {
    cwd: process.cwd(),
    stdio: "inherit",
  });
}

run("pnpm", ["exec", "bumpp", "--preid", "beta"]);
run("pnpm", ["run", skipTests ? "release:prepare:no-test" : "release:prepare"]);
run("pnpm", ["run", "publish:beta"]);
