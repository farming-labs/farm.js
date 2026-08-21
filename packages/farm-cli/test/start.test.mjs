import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createFarmStartPlan } = require("../dist/index.js");

async function withTempRoot(name, run) {
  let root;
  try {
    root = await mkdtemp(path.join(tmpdir(), name));
    await run(root);
  } finally {
    if (root) await rm(root, { recursive: true, force: true });
  }
}

test("resolves a start plan for the node target and maps port/host to Nitro env vars", async () => {
  await withTempRoot("farm-cli-start-node-", async (root) => {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'node', output: '.output' } };\n",
    );
    const serverEntry = path.join(root, ".output", "server", "index.mjs");
    await mkdir(path.dirname(serverEntry), { recursive: true });
    await writeFile(serverEntry, "export {};\n");

    const plan = await createFarmStartPlan({
      root,
      port: 4000,
      host: "0.0.0.0",
    });

    assert.equal(plan.target, "node");
    assert.equal(plan.preset, "node-server");
    assert.equal(plan.serverEntry, serverEntry);
    assert.deepEqual(plan.command, { command: process.execPath, args: [serverEntry] });
    assert.deepEqual(plan.env, { NITRO_PORT: "4000", NITRO_HOST: "0.0.0.0" });
  });
});

test("defaults to the node-server preset when no deploy target is configured", async () => {
  await withTempRoot("farm-cli-start-default-", async (root) => {
    await writeFile(path.join(root, "farm.config.mjs"), "export default {};\n");
    const serverEntry = path.join(root, ".farm", ".output", "server", "index.mjs");
    await mkdir(path.dirname(serverEntry), { recursive: true });
    await writeFile(serverEntry, "export {};\n");

    const plan = await createFarmStartPlan({ root });

    assert.equal(plan.target, "node");
    assert.equal(plan.preset, "node-server");
    assert.equal(plan.serverEntry, serverEntry);
    assert.deepEqual(plan.env, {});
  });
});

test("rejects presets without a known local server entry", async () => {
  await withTempRoot("farm-cli-start-preset-", async (root) => {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { preset: 'deno' } };\n",
    );

    await assert.rejects(createFarmStartPlan({ root }), (error) => {
      assert.equal(error.name, "FarmStartError");
      assert.equal(error.code, "UNSUPPORTED_PRESET");
      assert.match(error.message, /deno/);
      assert.match(error.message, /deploy\.target: "node"/);
      return true;
    });
  });
});

test("rejects platform targets with a per-target hint instead of guessing", async () => {
  await withTempRoot("farm-cli-start-vercel-", async (root) => {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'vercel' } };\n",
    );

    await assert.rejects(createFarmStartPlan({ root }), (error) => {
      assert.equal(error.name, "FarmStartError");
      assert.equal(error.code, "PLATFORM_TARGET");
      assert.match(error.message, /farm deploy --vercel/);
      assert.match(error.message, /deploy\.target: "node"/);
      return true;
    });
  });
});

test("reports missing build output and hints at farm build", async () => {
  await withTempRoot("farm-cli-start-missing-", async (root) => {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      "export default { deploy: { target: 'node', output: '.output' } };\n",
    );

    await assert.rejects(createFarmStartPlan({ root }), (error) => {
      assert.equal(error.name, "FarmStartError");
      assert.equal(error.code, "MISSING_OUTPUT");
      assert.match(error.message, /farm build/);
      assert.match(error.message, /index\.mjs/);
      return true;
    });
  });
});
