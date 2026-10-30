import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { ensureFarmRscPackages } = require("../dist/index.js");

async function createApp(packages = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-rsc-install-"));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "app" }));
  await writeFile(path.join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  for (const [name, manifest] of Object.entries(packages)) {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name, ...manifest }));
  }
  return root;
}

/** Records commands and installs the plugin like a package manager would. */
function fakeInstaller(root, commands) {
  return async (command) => {
    commands.push(`${command.command} ${command.args.join(" ")}`);
    if (command.args.some((spec) => spec.startsWith("@farm.js/plugin"))) {
      const dir = path.join(root, "node_modules/@farm.js/plugin");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "package.json"),
        JSON.stringify({
          name: "@farm.js/plugin",
          version: "0.1.40",
          peerDependencies: {
            "@vitejs/plugin-rsc": "0.5.32",
            react: "19.2.8",
            "react-dom": "19.2.8",
            "react-server-dom-webpack": "19.2.8",
            vite: ">=6.0.0",
          },
        }),
      );
    }
  };
}

const flag = { experimental: { serverComponents: true } };

test("installs the RSC packages with the app's package manager at the plugin's pins", async () => {
  const root = await createApp({
    "@farm.js/core": { version: "0.1.40" },
    react: { version: "19.2.8" },
    "react-dom": { version: "19.1.0" },
  });
  try {
    const commands = [];
    const installed = await ensureFarmRscPackages(flag, root, fakeInstaller(root, commands), {});
    assert.deepEqual(commands, [
      "pnpm add @farm.js/plugin@0.1.40",
      "pnpm add @vitejs/plugin-rsc@0.5.32 react-dom@19.2.8 react-server-dom-webpack@19.2.8",
    ]);
    assert.equal(installed.length, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installs nothing when RSC is off, already installed, or would be blocked", async () => {
  const commands = [];
  const run = async (command) => commands.push(command);
  const ready = await createApp({
    "@farm.js/plugin": { version: "0.1.40" },
    "@vitejs/plugin-rsc": { version: "0.5.32" },
    "react-server-dom-webpack": { version: "19.2.8" },
  });
  const empty = await createApp();
  try {
    await ensureFarmRscPackages({}, empty, run, {});
    await ensureFarmRscPackages(flag, ready, run, {});
    // An app that set the flag before it ran RSC and uses auth keeps working as it was.
    await ensureFarmRscPackages({ ...flag, auth: true }, empty, run, {});
    assert.equal(commands.length, 0);

    // An explicit { mode: "rsc" } is a deliberate choice, so it installs.
    const explicit = [];
    await ensureFarmRscPackages(
      { auth: true, experimental: { serverComponents: { mode: "rsc" } } },
      empty,
      fakeInstaller(empty, explicit),
      {},
    );
    assert.equal(explicit[0], "pnpm add @farm.js/plugin");
  } finally {
    await rm(ready, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test("CI never installs: true keeps its fallback, an explicit mode fails with the command", async () => {
  const root = await createApp({ "@farm.js/core": { version: "0.1.40" } });
  try {
    const commands = [];
    const run = async (command) => commands.push(command);
    assert.deepEqual(await ensureFarmRscPackages(flag, root, run, { CI: "true" }), []);
    await assert.rejects(
      ensureFarmRscPackages({ experimental: { serverComponents: { mode: "rsc" } } }, root, run, {
        GITHUB_ACTIONS: "true",
      }),
      /CI does not change dependencies: run `pnpm add @farm\.js\/plugin/,
    );
    assert.equal(commands.length, 0);
    // CI=false is not CI.
    await ensureFarmRscPackages(flag, root, fakeInstaller(root, commands), { CI: "false" });
    assert.equal(commands[0], "pnpm add @farm.js/plugin@0.1.40");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an app inside a workspace uses the workspace root's package manager", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "farm-cli-rsc-workspace-"));
  const root = path.join(workspace, "apps", "web");
  try {
    await writeFile(path.join(workspace, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "workspace" }));
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "web" }));
    const commands = [];
    await ensureFarmRscPackages(flag, root, fakeInstaller(root, commands), {});
    assert.equal(commands[0], "pnpm add @farm.js/plugin");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("installs without NODE_ENV, so the package manager keeps devDependencies", async () => {
  const root = await createApp({ "@farm.js/core": { version: "0.1.40" } });
  try {
    const envs = [];
    const install = fakeInstaller(root, []);
    await ensureFarmRscPackages(
      flag,
      root,
      async (command) => {
        envs.push(command.env);
        await install(command);
      },
      { NODE_ENV: "production", PATH: "/usr/bin" },
    );
    assert.ok(envs.length > 0);
    for (const env of envs) {
      assert.equal(env.NODE_ENV, undefined);
      assert.equal(env.PATH, "/usr/bin");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("moves an app's react to the plugin's tested version, which RSC requires", async () => {
  const root = await createApp({
    "@farm.js/core": { version: "0.1.40" },
    react: { version: "19.3.1" },
    "react-dom": { version: "19.3.1" },
  });
  try {
    const commands = [];
    await ensureFarmRscPackages(flag, root, fakeInstaller(root, commands), {});
    assert.deepEqual(commands, [
      "pnpm add @farm.js/plugin@0.1.40",
      "pnpm add @vitejs/plugin-rsc@0.5.32 react@19.2.8 react-dom@19.2.8 react-server-dom-webpack@19.2.8",
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
