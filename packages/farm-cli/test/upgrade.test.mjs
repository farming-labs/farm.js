import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { createFarmUpgradePlan, upgradeFarm } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("plans stable upgrades with the detected package manager and dependency sections", async () => {
  const root = await createTempProject({
    packageManager: "pnpm@8.12.1",
    dependencies: {
      "@farm.js/core": "^0.1.0-beta.3",
      react: "^19.0.0",
    },
    devDependencies: {
      "@farm.js/cli": "^0.1.0-beta.3",
    },
    optionalDependencies: {
      "@farm.js/plugin": "^0.1.0-beta.3",
    },
    peerDependencies: {
      "@farm.js/integrations": "^0.1.0-beta.3",
    },
  });

  try {
    const plan = await createFarmUpgradePlan({ root, channel: "latest" });

    assert.equal(plan.packageManager, "pnpm");
    assert.deepEqual(
      plan.packages.map(({ name, section, target }) => ({ name, section, target })),
      [
        {
          name: "@farm.js/cli",
          section: "devDependencies",
          target: "@farm.js/cli@latest",
        },
        {
          name: "@farm.js/core",
          section: "dependencies",
          target: "@farm.js/core@latest",
        },
        {
          name: "@farm.js/integrations",
          section: "peerDependencies",
          target: "@farm.js/integrations@latest",
        },
        {
          name: "@farm.js/plugin",
          section: "optionalDependencies",
          target: "@farm.js/plugin@latest",
        },
      ],
    );
    assert.deepEqual(
      plan.commands.map(({ command, args }) => ({ command, args })),
      [
        {
          command: "pnpm",
          args: ["add", "@farm.js/core@latest"],
        },
        {
          command: "pnpm",
          args: ["add", "--save-dev", "@farm.js/cli@latest"],
        },
        {
          command: "pnpm",
          args: ["add", "--save-optional", "@farm.js/plugin@latest"],
        },
        {
          command: "pnpm",
          args: ["add", "--save-peer", "@farm.js/integrations@latest"],
        },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executes beta upgrades and skips local Farm packages", async () => {
  const root = await createTempProject({
    dependencies: {
      "@farm.js/core": "^0.1.0-beta.3",
      "@farm.js/plugin": "workspace:*",
    },
  });
  const commands = [];

  try {
    const result = await upgradeFarm({
      root,
      channel: "beta",
      packageManager: "npm",
      runCommand: async (command) => {
        commands.push(command);
      },
    });

    assert.equal(result.executed, true);
    assert.equal(result.plan.skipped.length, 1);
    assert.equal(result.plan.skipped[0].name, "@farm.js/plugin");
    assert.deepEqual(
      commands.map(({ command, args }) => ({ command, args })),
      [
        {
          command: "npm",
          args: ["install", "@farm.js/core@beta"],
        },
      ],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("detects Bun from its lockfile when packageManager is not declared", async () => {
  const root = await createTempProject({
    dependencies: {
      "@farm.js/core": "^0.1.0-beta.3",
    },
  });

  try {
    await writeFile(path.join(root, "bun.lock"), "", "utf8");

    const plan = await createFarmUpgradePlan({ root, channel: "latest" });

    assert.equal(plan.packageManager, "bun");
    assert.deepEqual(plan.commands[0].args, ["add", "@farm.js/core@latest"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prints a dry-run plan through the CLI", async () => {
  const root = await createTempProject({
    packageManager: "pnpm@8.12.1",
    dependencies: {
      "@farm.js/core": "^0.1.0-beta.3",
    },
    devDependencies: {
      "@farm.js/cli": "^0.1.0-beta.3",
    },
  });

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      cliBin,
      "upgrade",
      "--latest",
      "--root",
      root,
      "--dry-run",
    ]);

    assert.match(stdout, /Farm upgrade: latest stable/);
    assert.match(stdout, /pnpm add @farm\.js\/core@latest/);
    assert.match(stdout, /pnpm add --save-dev @farm\.js\/cli@latest/);
    assert.match(stdout, /Dry run only\. No packages were changed\./);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("requires an explicit stable or beta channel", async () => {
  const root = await createTempProject({
    dependencies: {
      "@farm.js/core": "^0.1.0-beta.3",
    },
  });

  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [cliBin, "upgrade", "--root", root, "--dry-run"]),
      /Choose exactly one release channel/,
    );
    await assert.rejects(
      () =>
        execFileAsync(process.execPath, [
          cliBin,
          "upgrade",
          "--latest",
          "--beta",
          "--root",
          root,
          "--dry-run",
        ]),
      /Choose exactly one release channel/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempProject(packageJson) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-upgrade-"));
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "upgrade-fixture", ...packageJson }, null, 2)}\n`,
    "utf8",
  );
  return root;
}
