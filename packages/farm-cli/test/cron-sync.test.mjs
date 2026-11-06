import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { syncFarmCronJobs } = require("../dist/index.js");
const execFileAsync = promisify(execFile);
const cli = fileURLToPath(new URL("../bin/farm.js", import.meta.url));
const job = {
  name: "cleanup",
  path: "/api/cleanup",
  schedule: ["0 2 * * *"],
  description: null,
  timeoutMs: 25000,
};

async function fixture(t, { scheduler = "farmjs", jobs = [job], handler } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-cron-sync-"));
  const originalEnv = { ...process.env };
  const requests = [];
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (handler) return handler(request, response, body);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ accepted: body.jobs.length }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
  });
  process.env.FARMJS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.FARMJS_ENVIRONMENT = "staging";
  process.env.FARMJS_PROJECT_ID = "proj_test";
  process.env.FARMJS_API_KEY = "farmjs_test_only";
  await mkdir(path.join(root, ".farm"));
  const manifest = { schemaVersion: 1, scheduler, secretEnv: "CRON_SECRET", jobs };
  await writeFile(path.join(root, ".farm/cron-manifest.json"), JSON.stringify(manifest));
  return { root, requests, options: { root, url: "https://app.example.com" }, manifest };
}

test("plans without credentials or network, then applies the built manifest with its exact scope", async (t) => {
  const { root, requests, options } = await fixture(t);
  delete process.env.FARMJS_API_KEY;
  await writeFile(
    path.join(root, "farm.config.ts"),
    "throw new Error('must not evaluate source config');",
  );
  const plan = await syncFarmCronJobs(options);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.applied, false);
  assert.equal(plan.scheduler, "farmjs");
  assert.equal(requests.length, 0);
  await assert.rejects(syncFarmCronJobs({ ...options, apply: true }), /FARMJS_API_KEY/);
  process.env.FARMJS_API_KEY = "farmjs_test_only";
  const applied = await syncFarmCronJobs({ ...options, apply: true });
  assert.equal(applied.accepted, 1);
  assert.equal(applied.applied, true);
  assert.equal(requests[0].method, "PUT");
  assert.equal(requests[0].url, "/api/cron/jobs");
  assert.equal(requests[0].headers.authorization, "Bearer farmjs_test_only");
  assert.equal(requests[0].headers["x-farm-environment"], "staging");
  assert.equal(requests[0].headers["x-farm-project"], "proj_test");
  assert.deepEqual(requests[0].body, {
    endpoint: options.url,
    jobs: [{ name: job.name, path: job.path, schedule: job.schedule, timeoutMs: job.timeoutMs }],
  });
  assert.ok(!JSON.stringify(applied).includes("farmjs_test_only"));
});

for (const variant of [
  { scheduler: "farmjs", jobs: [] },
  { scheduler: "host", jobs: [job] },
]) {
  test(`clears the endpoint for ${variant.scheduler} with ${variant.jobs.length} manifest jobs only when explicitly allowed`, async (t) => {
    const { requests, options } = await fixture(t, variant);
    assert.equal((await syncFarmCronJobs(options)).jobs.length, 0);
    await assert.rejects(syncFarmCronJobs({ ...options, apply: true }), /--allow-delete/);
    assert.equal(requests.length, 0);
    await syncFarmCronJobs({ ...options, apply: true, allowDelete: true });
    assert.deepEqual(requests[0].body, { endpoint: options.url, jobs: [] });
  });
}

test("requires an explicit environment and a public HTTPS origin without silently stripping input", async (t) => {
  const { options, requests } = await fixture(t);
  delete process.env.FARMJS_ENVIRONMENT;
  await assert.rejects(syncFarmCronJobs(options), /FARMJS_ENVIRONMENT/);
  process.env.FARMJS_ENVIRONMENT = "production";
  for (const url of [
    "http://app.example.com",
    "https://app.example.com/path",
    "https://u:p@app.example.com",
    "https://app.example.com/?",
    "https://localhost",
    "https://127.0.0.1",
    "https://app.local",
    "https://app.example.com/#",
  ]) {
    await assert.rejects(syncFarmCronJobs({ ...options, url }), /HTTPS origin/);
  }
  assert.equal(requests.length, 0);
});

test("rejects missing, unsupported, duplicate and invalid manifests before sending", async (t) => {
  const { options, root, requests, manifest } = await fixture(t);
  await assert.rejects(
    syncFarmCronJobs({ ...options, manifest: "absent.json" }),
    /Run `farm build`/,
  );
  for (const value of [
    { ...manifest, schemaVersion: 2 },
    { ...manifest, scheduler: "other" },
    { ...manifest, jobs: [job, job] },
    { ...manifest, jobs: [{ ...job, path: "/../admin" }] },
    { ...manifest, jobs: [{ ...job, timeoutMs: 10 }] },
  ]) {
    await writeFile(path.join(root, ".farm/cron-manifest.json"), JSON.stringify(value));
    await assert.rejects(syncFarmCronJobs({ ...options, apply: true }), {
      code: "INVALID_MANIFEST",
    });
  }
  assert.equal(requests.length, 0);
});

for (const [name, status, body] of [
  ["refusal", 403, { error: "denied" }],
  ["invalid acknowledgement", 200, {}],
  ["partial acknowledgement", 200, { accepted: 0 }],
]) {
  test(`fails closed on ${name}`, async (t) => {
    const { options } = await fixture(t, {
      handler(_request, response) {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(status === 403 ? { ...body, message: "No cron:jobs." } : body));
      },
    });
    await assert.rejects(syncFarmCronJobs({ ...options, apply: true }), {
      name: "FarmCronSyncError",
      code: "SYNC_FAILED",
      message: status === 403 ? /HTTP 403\. Infra said \(denied\)/ : /acknowledged/,
    });
  });
}

test("refuses redirects without following them with credentials", async (t) => {
  const { options, requests } = await fixture(t, {
    handler(_request, response) {
      response.writeHead(307, { location: "/redirected" });
      response.end();
    },
  });
  await assert.rejects(syncFarmCronJobs({ ...options, apply: true }), {
    code: "SYNC_FAILED",
    message: /redirects are refused/,
  });
  assert.equal(requests.length, 1);
});

test("aborts an unresponsive synchronization at its deadline", async (t) => {
  const { options } = await fixture(t);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  let signal;
  const pending = syncFarmCronJobs({
    ...options,
    apply: true,
    fetch: async (_url, init) => {
      signal = init.signal;
      started.resolve();
      return new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
      );
    },
  });
  const rejected = assert.rejects(pending, { code: "SYNC_FAILED", message: /did not answer/ });
  await started.promise;
  t.mock.timers.tick(15_000);
  await rejected;
  assert.equal(signal.aborted, true);
  t.mock.timers.reset();
});

test("the packaged command defaults to a JSON plan and only --apply mutates", async (t) => {
  const { root, requests, options } = await fixture(t);
  const args = [cli, "cron", "sync", "--root", root, "--url", options.url, "--json"];
  const planned = await execFileAsync(process.execPath, args);
  assert.equal(JSON.parse(planned.stdout).applied, false);
  assert.equal(requests.length, 0);
  const applied = await execFileAsync(process.execPath, [...args, "--apply"]);
  assert.equal(JSON.parse(applied.stdout).accepted, 1);
  assert.equal(requests.length, 1);
});

test("the packaged command prints the error code and the fix, and exits 1", async (t) => {
  const { root, requests, options } = await fixture(t);
  delete process.env.FARMJS_API_KEY;
  const args = [cli, "cron", "sync", "--root", root, "--url", options.url, "--apply"];
  await assert.rejects(execFileAsync(process.execPath, args), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /\[MISSING_API_KEY\]: Set `FARMJS_API_KEY`/);
    return true;
  });
  assert.equal(requests.length, 0);
});
