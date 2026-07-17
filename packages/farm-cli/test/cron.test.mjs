import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const {
  formatFarmCronJobs,
  listFarmCronJobs,
  runFarmCronJob,
  startFarmCronScheduler,
} = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(testDir, "../bin/farm.js");

test("lists configured cron routes", async () => {
  const root = await createTempProject();

  try {
    const jobs = await listFarmCronJobs({ root });

    assert.deepEqual(jobs, [
      {
        name: "dailyCleanup",
        schedule: ["0 2 * * *"],
        path: "/api/maintenance/cleanup",
        description: "Delete expired sessions.",
      },
    ]);
    assert.match(formatFarmCronJobs(jobs), /SCHEDULE \(UTC\)/);
    assert.match(formatFarmCronJobs(jobs), /dailyCleanup/);
    assert.match(formatFarmCronJobs(jobs), /\/api\/maintenance\/cleanup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs a configured route with cron metadata and bearer auth", async () => {
  const root = await createTempProject();
  let request;

  try {
    const result = await runFarmCronJob("dailyCleanup", {
      root,
      url: "http://localhost:4319",
      secret: "test-secret",
      fetch: async (input, init) => {
        request = { input: String(input), init };
        return Response.json({ deleted: 4 });
      },
    });

    assert.equal(request.input, "http://localhost:4319/api/maintenance/cleanup");
    const headers = new Headers(request.init.headers);
    assert.equal(headers.get("authorization"), "Bearer test-secret");
    assert.equal(headers.get("x-farm-cron-name"), "dailyCleanup");
    assert.equal(headers.get("x-farm-cron-trigger"), "manual");
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { deleted: 4 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("starts UTC development schedules and stops them cleanly", async () => {
  const root = await createTempProject();

  try {
    const scheduler = await startFarmCronScheduler({
      root,
      url: "http://localhost:4319",
      fetch: async () => Response.json({ ok: true }),
    });

    assert.equal(scheduler.entries.length, 1);
    assert.equal(scheduler.entries[0].timer.options.timezone, "UTC");
    assert.ok(scheduler.entries[0].timer.nextRun() instanceof Date);
    scheduler.stop();
    assert.equal(scheduler.entries[0].timer.isStopped(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runs cron list and cron run through the CLI", async () => {
  const root = await createTempProject();
  const server = await createTestServer();

  try {
    const listed = await execFileAsync(process.execPath, [cliBin, "cron", "list", "--root", root]);
    assert.match(listed.stdout, /dailyCleanup/);
    assert.match(listed.stdout, /0 2 \* \* \*/);

    const run = await execFileAsync(process.execPath, [
      cliBin,
      "cron",
      "run",
      "dailyCleanup",
      "--root",
      root,
      "--url",
      server.url,
      "--secret",
      "test-secret",
    ]);
    assert.match(run.stdout, /completed with 200/);
    assert.match(run.stdout, /"authorized": true/);
  } finally {
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function createTempProject() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cli-cron-"));
  await writeFile(
    path.join(root, "farm.config.mjs"),
    [
      "export default {",
      "  cron: {",
      "    dailyCleanup: {",
      "      schedule: '0 2 * * *',",
      "      path: '/api/maintenance/cleanup',",
      "      description: 'Delete expired sessions.',",
      "    },",
      "  },",
      "};",
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

async function createTestServer() {
  const server = createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        path: request.url,
        authorized: request.headers.authorization === "Bearer test-secret",
      }),
    );
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start test server.");

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
