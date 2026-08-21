import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  getFarmTelemetryConfigFile,
  getFarmTelemetryStatus,
  resolveFarmCreateAppTelemetryCommand,
  resolveFarmTelemetryCommand,
  setFarmTelemetryEnabled,
  trackFarmCreateAppCommand,
  trackFarmCommand,
  trackFarmProjectCreated,
} from "../dist/telemetry.mjs";

const TELEMETRY_ENV_KEYS = [
  "BUILDKITE",
  "CI",
  "CIRCLECI",
  "DO_NOT_TRACK",
  "FARM_TELEMETRY",
  "FARM_TELEMETRY_CONFIG_DIR",
  "FARM_TELEMETRY_DISABLED",
  "FARM_TELEMETRY_ENDPOINT",
  "GITHUB_ACTIONS",
  "NODE_ENV",
];

async function withTelemetryEnvironment(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farm-cli-telemetry-"));
  const previous = Object.fromEntries(TELEMETRY_ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  for (const key of TELEMETRY_ENV_KEYS) delete process.env[key];
  process.env.FARM_TELEMETRY_CONFIG_DIR = directory;
  process.env.FARM_TELEMETRY_ENDPOINT = "http://127.0.0.1:43199/events";

  try {
    await run(directory);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of TELEMETRY_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
}

test("telemetry is enabled without creating an identity by default", async () => {
  await withTelemetryEnvironment(async () => {
    const status = await getFarmTelemetryStatus();
    assert.equal(status.enabled, true);
    assert.equal(status.active, false);
    assert.equal(status.source, "default");
    assert.match(status.reason, /non-interactive/);
    assert.equal(status.anonymousId, undefined);
  });
});

test("telemetry remains inactive in recognized CI environments", async () => {
  await withTelemetryEnvironment(async () => {
    for (const key of ["CI", "GITHUB_ACTIONS", "BUILDKITE", "CIRCLECI"]) {
      process.env[key] = "true";

      const status = await getFarmTelemetryStatus();
      assert.equal(status.enabled, true);
      assert.equal(status.active, false);
      assert.equal(status.source, "default");
      assert.equal(status.reason, "CI environments are skipped");
      assert.equal(status.anonymousId, undefined);

      delete process.env[key];
    }
  });
});

test("enable persists an anonymous ID and disable removes it", async () => {
  await withTelemetryEnvironment(async () => {
    await setFarmTelemetryEnabled(true);
    const firstConfig = JSON.parse(await readFile(getFarmTelemetryConfigFile(), "utf8"));
    assert.match(firstConfig.anonymousId, /^[0-9a-f-]{36}$/i);

    await setFarmTelemetryEnabled(false);
    const disabledConfig = JSON.parse(await readFile(getFarmTelemetryConfigFile(), "utf8"));
    assert.equal(disabledConfig.enabled, false);
    assert.equal(disabledConfig.anonymousId, undefined);
    const disabledStatus = await getFarmTelemetryStatus();
    assert.equal(disabledStatus.enabled, false);
    assert.equal(disabledStatus.source, "configuration");

    await setFarmTelemetryEnabled(true);
    const secondConfig = JSON.parse(await readFile(getFarmTelemetryConfigFile(), "utf8"));
    assert.notEqual(secondConfig.anonymousId, firstConfig.anonymousId);
  });
});

test("explicit telemetry sends only the strict command payload", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let request;
    globalThis.fetch = async (url, init) => {
      request = { url: String(url), init };
      return { ok: true };
    };

    await trackFarmCommand({
      command: "deploy",
      packageVersion: "0.1.0-beta.36",
      deployTarget: "vercel",
    });

    assert.equal(request.url, "http://127.0.0.1:43199/events");
    const payload = JSON.parse(request.init.body);
    assert.deepEqual(
      Object.keys(payload).sort(),
      [
        "anonymousId",
        "architecture",
        "command",
        "deployTarget",
        "eventId",
        "eventType",
        "nodeMajor",
        "packageName",
        "packageVersion",
        "platform",
        "schemaVersion",
        "source",
      ].sort(),
    );
    assert.equal(payload.eventType, "command_invoked");
    assert.equal(payload.command, "deploy");
    assert.equal(JSON.stringify(payload).includes(process.cwd()), false);
  });
});

test("published CLI command paths are explicitly allowlisted", () => {
  for (const command of [
    "dev",
    "build",
    "auth:migrate",
    "upgrade",
    "generate",
    "doctor",
    "explain",
    "preview",
    "migrate",
    "cron:list",
    "cron:run",
    "add:integration",
    "deploy",
  ]) {
    assert.equal(resolveFarmTelemetryCommand(command), command);
  }

  assert.equal(resolveFarmTelemetryCommand("telemetry:disable"), undefined);
  assert.equal(resolveFarmCreateAppTelemetryCommand("create"), "create");
  assert.equal(resolveFarmCreateAppTelemetryCommand("list-templates"), "list-templates");
  assert.equal(resolveFarmCreateAppTelemetryCommand("unknown"), undefined);
});

test("create-app commands use the generator package identity", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let payload;
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(init.body);
      return { ok: true };
    };

    await trackFarmCreateAppCommand({
      command: "list-templates",
      packageVersion: "0.1.0-beta.52",
    });

    assert.equal(payload.eventType, "command_invoked");
    assert.equal(payload.source, "create-app");
    assert.equal(payload.packageName, "@farm.js/create-app");
    assert.equal(payload.command, "list-templates");
    assert.equal(payload.deployTarget, undefined);
  });
});

test("project metadata is allowlisted instead of forwarding arbitrary strings", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let payload;
    globalThis.fetch = async (_url, init) => {
      payload = JSON.parse(init.body);
      return { ok: true };
    };

    await trackFarmProjectCreated({
      packageVersion: "../../../secret",
      template: "/private/project",
      renderer: "react",
      packageManager: "pnpm",
      typescript: true,
      installedDependencies: false,
    });

    assert.equal(payload.packageVersion, "unknown");
    assert.equal(payload.template, undefined);
    assert.equal(payload.renderer, "react");
    assert.equal(payload.packageManager, "pnpm");
    assert.equal(payload.typescript, true);
    assert.equal(payload.installedDependencies, false);
  });
});

test("DO_NOT_TRACK wins over an explicit enable flag", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    process.env.DO_NOT_TRACK = "1";
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return { ok: true };
    };

    await trackFarmCommand({ command: "build", packageVersion: "0.1.0-beta.36" });
    const status = await getFarmTelemetryStatus();
    assert.equal(called, false);
    assert.equal(status.enabled, false);
    assert.match(status.reason, /DO_NOT_TRACK/);
  });
});

test("transport failures never reject a Farm command", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    globalThis.fetch = async () => {
      throw new Error("offline");
    };
    await assert.doesNotReject(
      trackFarmCommand({ command: "doctor", packageVersion: "0.1.0-beta.36" }),
    );
  });
});
