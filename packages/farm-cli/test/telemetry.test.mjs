import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  flushFarmTelemetry,
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
  "FARM_TELEMETRY_DEBUG",
  "FARM_TELEMETRY_ENDPOINT",
  "GITHUB_ACTIONS",
  "NODE_ENV",
];

async function withTelemetryEnvironment(run) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "farm-cli-telemetry-"));
  const previous = Object.fromEntries(TELEMETRY_ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of TELEMETRY_ENV_KEYS) delete process.env[key];
  process.env.FARM_TELEMETRY_CONFIG_DIR = directory;
  process.env.FARM_TELEMETRY_ENDPOINT = "http://127.0.0.1:43199/events";

  try {
    await run(directory);
  } finally {
    for (const key of TELEMETRY_ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    await rm(directory, { recursive: true, force: true });
  }
}

async function withTelemetryServer(handler, run) {
  const sockets = new Set();
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.destroy();
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  process.env.FARM_TELEMETRY_ENDPOINT = `http://127.0.0.1:${address.port}/events`;

  try {
    await run();
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function accept(response, status = 202) {
  response.writeHead(status);
  response.end();
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

test("tracking returns before background delivery completes", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let finishRequest;
    let requestStarted;
    const started = new Promise((resolve) => {
      requestStarted = resolve;
    });

    await withTelemetryServer(
      async (request, response) => {
        await readRequestBody(request);
        requestStarted();
        await new Promise((resolve) => {
          finishRequest = () => {
            accept(response);
            resolve();
          };
        });
      },
      async () => {
        await trackFarmCommand({ command: "dev", packageVersion: "0.1.0-beta.58" });
        assert.equal(finishRequest, undefined);

        await started;
        finishRequest();
        await flushFarmTelemetry();
      },
    );
  });
});

test("pending telemetry does not keep a short-lived process open", async () => {
  await withTelemetryEnvironment(async (directory) => {
    process.env.FARM_TELEMETRY = "1";
    await withTelemetryServer(
      async (request) => {
        await readRequestBody(request);
        // Deliberately leave the response open. The client socket must not keep the child alive.
      },
      async () => {
        const telemetryModule = new URL("../dist/telemetry.mjs", import.meta.url).href;
        const script = `import { trackFarmCommand } from ${JSON.stringify(
          telemetryModule,
        )}; void trackFarmCommand({ command: "build", packageVersion: "test" });`;
        const startedAt = Date.now();
        const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
          env: {
            ...process.env,
            FARM_TELEMETRY: "1",
            FARM_TELEMETRY_CONFIG_DIR: directory,
          },
          stdio: "ignore",
        });
        const [exitCode, signal] = await once(child, "exit");
        const elapsed = Date.now() - startedAt;

        assert.equal(signal, null);
        assert.equal(exitCode, 0);
        assert.ok(elapsed < 2_000, `telemetry kept the process open for ${elapsed}ms`);
      },
    );
  });
});

test("explicit telemetry sends only the strict command payload", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let request;
    await withTelemetryServer(
      async (incoming, response) => {
        request = { url: incoming.url, body: await readRequestBody(incoming) };
        accept(response);
      },
      async () => {
        void trackFarmCommand({
          command: "deploy",
          packageVersion: "0.1.0-beta.36",
          deployTarget: "vercel",
        });
        await flushFarmTelemetry();

        assert.equal(request.url, "/events");
        const payload = JSON.parse(request.body);
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
      },
    );
  });
});

test("published CLI command paths are explicitly allowlisted", () => {
  for (const command of [
    "dev",
    "build",
    "start",
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
    await withTelemetryServer(
      async (request, response) => {
        payload = JSON.parse(await readRequestBody(request));
        accept(response);
      },
      async () => {
        void trackFarmCreateAppCommand({
          command: "list-templates",
          packageVersion: "0.1.0-beta.52",
        });
        await flushFarmTelemetry();

        assert.equal(payload.eventType, "command_invoked");
        assert.equal(payload.source, "create-app");
        assert.equal(payload.packageName, "@farm.js/create-app");
        assert.equal(payload.command, "list-templates");
        assert.equal(payload.deployTarget, undefined);
      },
    );
  });
});

test("project metadata is allowlisted instead of forwarding arbitrary strings", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    let payload;
    await withTelemetryServer(
      async (request, response) => {
        payload = JSON.parse(await readRequestBody(request));
        accept(response);
      },
      async () => {
        void trackFarmProjectCreated({
          packageVersion: "../../../secret",
          template: "/private/project",
          renderer: "react",
          packageManager: "pnpm",
          typescript: true,
          installedDependencies: false,
        });
        await flushFarmTelemetry();

        assert.equal(payload.packageVersion, "unknown");
        assert.equal(payload.template, undefined);
        assert.equal(payload.renderer, "react");
        assert.equal(payload.packageManager, "pnpm");
        assert.equal(payload.typescript, true);
        assert.equal(payload.installedDependencies, false);
      },
    );
  });
});

test("DO_NOT_TRACK wins over an explicit enable flag", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    process.env.DO_NOT_TRACK = "1";
    let called = false;
    await withTelemetryServer(
      (_request, response) => {
        called = true;
        accept(response);
      },
      async () => {
        void trackFarmCommand({ command: "build", packageVersion: "0.1.0-beta.36" });
        await flushFarmTelemetry();
        const status = await getFarmTelemetryStatus();
        assert.equal(called, false);
        assert.equal(status.enabled, false);
        assert.match(status.reason, /DO_NOT_TRACK/);
      },
    );
  });
});

test("transport failures never reject a Farm command", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    const unavailable = createServer();
    unavailable.listen(0, "127.0.0.1");
    await once(unavailable, "listening");
    const address = unavailable.address();
    assert.notEqual(address, null);
    assert.equal(typeof address, "object");
    process.env.FARM_TELEMETRY_ENDPOINT = `http://127.0.0.1:${address.port}/events`;
    await new Promise((resolve) => unavailable.close(resolve));

    await assert.doesNotReject(
      trackFarmCommand({
        command: "doctor",
        packageVersion: "0.1.0-beta.36",
      }),
    );
    await assert.doesNotReject(flushFarmTelemetry());
  });
});

test("transient HTTP failures are retried in the background", async () => {
  await withTelemetryEnvironment(async () => {
    process.env.FARM_TELEMETRY = "1";
    const statuses = [503, 202];
    let attempts = 0;
    await withTelemetryServer(
      async (request, response) => {
        await readRequestBody(request);
        accept(response, statuses[attempts++] ?? 202);
      },
      async () => {
        void trackFarmCommand({ command: "build", packageVersion: "0.1.0-beta.58" });
        await flushFarmTelemetry();
        assert.equal(attempts, 2);
      },
    );
  });
});
