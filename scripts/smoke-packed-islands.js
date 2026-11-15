/** Runs the maintained islands contract against tarballs installed outside the workspace. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { readPublicPackages } = require("./public-packages");
const { collectFarmPackages, packPackage, pinToArchives } = require("./smoke-packed-app");

const repositoryRoot = path.resolve(__dirname, "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const playwrightVersion = require("@playwright/test/package.json").version;
const { packageManager } = require("../package.json");
const fixture = "examples/server-components";
const manifest = require(`../${fixture}/package.json`);
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "farm-packed-islands-"));
const archiveDirectory = path.join(temporaryRoot, "archives");
const appDirectory = path.join(temporaryRoot, fixture);
const env = { ...process.env, FARM_SERVER_COMPONENTS_MODE: "islands", FARM_SKIP_RSC_INSTALL: "1" };
delete env.FARM_SERVER_COMPONENTS_SERVER;
delete env.FARM_SERVER_COMPONENTS_TARGET;

function run(args, cwd = temporaryRoot) {
  execFileSync(pnpm, args, { cwd, env, stdio: "inherit" });
}

try {
  fs.mkdirSync(archiveDirectory);
  fs.mkdirSync(appDirectory, { recursive: true });
  const publicPackages = new Map(readPublicPackages(repositoryRoot).map((pkg) => [pkg.name, pkg]));
  const declared = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  const archives = new Map();
  for (const name of collectFarmPackages(declared, publicPackages)) {
    const pkg = publicPackages.get(name);
    console.log(`Packing ${name}@${pkg.version}...`);
    archives.set(name, packPackage(pkg, archiveDirectory));
  }

  // Keep the fixture and test paths unchanged, including the assertions about prerendered files.
  for (const relative of [
    `${fixture}/src`,
    // Local packages the fixture links (`link:./fixtures/...`).
    `${fixture}/fixtures`,
    `${fixture}/farm.config.ts`,
    `${fixture}/tsconfig.json`,
    "playwright.server-components.config.ts",
    "tests/e2e-server-components",
    ".npmrc",
  ]) {
    fs.cpSync(path.join(repositoryRoot, relative), path.join(temporaryRoot, relative), {
      recursive: true,
    });
  }
  fs.writeFileSync(
    path.join(appDirectory, "package.json"),
    `${JSON.stringify(pinToArchives(manifest, archives), null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(temporaryRoot, "package.json"),
    `${JSON.stringify(
      pinToArchives(
        {
          name: "farm-packed-islands-contract",
          private: true,
          packageManager,
          devDependencies: { "@playwright/test": playwrightVersion },
        },
        archives,
      ),
      null,
      2,
    )}\n`,
  );
  // The fixture and the workspace packages it depends on (`workspace:*`), as the repository lists them.
  const fixtureProjects = fs
    .readFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => /^\s*-\s*"?([^"#\s]+)"?\s*$/.exec(line)?.[1])
    .filter((entry) => entry && entry.startsWith(`${fixture}/`));
  fs.writeFileSync(
    path.join(temporaryRoot, "pnpm-workspace.yaml"),
    `packages:\n${[fixture, ...fixtureProjects].map((entry) => `  - ${entry}\n`).join("")}`,
  );

  console.log("Installing the islands fixture from packed artifacts...");
  run(["install", "--no-frozen-lockfile"]);
  run(["run", "type-check"], appDirectory);
  run(["exec", "playwright", "test", "--config", "playwright.server-components.config.ts"]);
  console.log(`Packed islands contract passed (${archives.size} Farm packages).`);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
} catch (error) {
  console.error(`Packed islands artifacts retained at ${temporaryRoot}`);
  console.error(error);
  process.exitCode = 1;
}
