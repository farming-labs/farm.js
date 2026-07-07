import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { migrateFarm } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("runs one-shot migration commands", async () => {
  const root = await createTempProject();

  try {
    await migrateFarm({
      root,
      commands: [nodeCommand("require('node:fs').writeFileSync('migrated.txt', 'ok')")],
    });

    assert.equal(await readFile(path.join(root, "migrated.txt"), "utf8"), "ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints migration commands without running them in dry-run mode", async () => {
  const root = await createTempProject();

  try {
    await migrateFarm({
      root,
      dryRun: true,
      commands: [nodeCommand("require('node:fs').writeFileSync('dry-run.txt', 'nope')")],
    });

    await assert.rejects(() => readFile(path.join(root, "dry-run.txt"), "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loads migration commands from farm.config", async () => {
  const root = await createTempProject();
  const command = nodeCommand(
    "require('node:fs').writeFileSync('configured.txt', process.env.FARM_MIGRATION_VALUE)",
  );

  try {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      `export default {
  migrations: {
    commands: [
      {
        name: "configured migration",
        command: ${JSON.stringify(command)},
        env: {
          FARM_MIGRATION_VALUE: "configured",
        },
      },
    ],
  },
};
`,
      "utf8",
    );

    await migrateFarm({ root });

    assert.equal(await readFile(path.join(root, "configured.txt"), "utf8"), "configured");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs farm migrate through the CLI", async () => {
  const root = await createTempProject();

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "migrate",
      "--root",
      root,
      "--command",
      nodeCommand("require('node:fs').writeFileSync('cli.txt', 'cli-ok')"),
    ]);

    assert.match(stdout, /Ran 1 migration command successfully/);
    assert.equal(await readFile(path.join(root, "cli.txt"), "utf8"), "cli-ok");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-migrate-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ type: "module", dependencies: {} }, null, 2),
    "utf8",
  );
  return root;
}

function nodeCommand(script) {
  return `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`;
}
