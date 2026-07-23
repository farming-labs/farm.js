import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { withProductionNodeEnv as withCoreProductionNodeEnv } from "@farmjs/core/internal/production-node-env";

const require = createRequire(import.meta.url);
const { withProductionNodeEnv: withCliProductionNodeEnv } = require("../dist/build.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

test("shares production NODE_ENV across overlapping CLI and core scopes", async () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const finishCli = deferred();
  const finishCore = deferred();
  const finishSurvivor = deferred();
  const rejectCli = deferred();

  try {
    process.env.NODE_ENV = "development";
    const cliOperation = withCliProductionNodeEnv(async () => {
      await finishCli.promise;
      assert.equal(process.env.NODE_ENV, "production");
    });
    const coreOperation = withCoreProductionNodeEnv(async () => {
      await finishCore.promise;
      assert.equal(process.env.NODE_ENV, "production");
    });

    assert.equal(process.env.NODE_ENV, "production");
    finishCli.resolve();
    await cliOperation;
    assert.equal(process.env.NODE_ENV, "production");

    finishCore.resolve();
    await coreOperation;
    assert.equal(process.env.NODE_ENV, "development");

    delete process.env.NODE_ENV;
    const survivor = withCoreProductionNodeEnv(async () => {
      await finishSurvivor.promise;
      assert.equal(process.env.NODE_ENV, "production");
    });
    const failure = withCliProductionNodeEnv(async () => {
      await rejectCli.promise;
      throw new Error("expected overlapping failure");
    });

    rejectCli.resolve();
    await assert.rejects(failure, /expected overlapping failure/);
    assert.equal(process.env.NODE_ENV, "production");

    finishSurvivor.resolve();
    await survivor;
    assert.equal(process.env.NODE_ENV, undefined);
  } finally {
    finishCli.resolve();
    finishCore.resolve();
    finishSurvivor.resolve();
    rejectCli.resolve();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  }
});

test("loads and resolves production config while NODE_ENV is production", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-build-node-env-"));

  try {
    await writeFile(
      path.join(root, "farm.config.mjs"),
      [
        'if (process.env.NODE_ENV !== "production") {',
        "  throw new Error(`config-load-node-env:${process.env.NODE_ENV}`);",
        "}",
        "export default {",
        "  generateBuildId() {",
        '    if (process.env.NODE_ENV !== "production") {',
        "      throw new Error(`config-resolve-node-env:${process.env.NODE_ENV}`);",
        "    }",
        '    throw new Error("config-resolved-in-production");',
        "  },",
        "};",
        "",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      execFileAsync(process.execPath, [cliBin, "build", "--root", root], {
        env: { ...process.env, NODE_ENV: "development" },
      }),
      (error) => {
        const output = `${error.stdout || ""}\n${error.stderr || ""}`;
        assert.match(output, /config-resolved-in-production/);
        assert.doesNotMatch(output, /config-(?:load|resolve)-node-env:/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
