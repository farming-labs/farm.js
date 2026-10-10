// Node 24.11+: focused reporter diagnostic, not a framework score.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import os from "node:os";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";

const source = readFileSync(new URL("../../packages/farm/src/preload.ts", import.meta.url), "utf8");
const candidate = stripTypeScriptTypes(source).replace(/^export /gm, "");
const begin = candidate.indexOf(
  "  if (warnings.length === 0 && reportedWarnings.size === 0) return;",
);
const end = candidate.indexOf("\n  for (const warning of warnings)", begin);
assert.ok(begin >= 0 && end > begin, "Expected the expiry-gated reporter");
const baseline = (
  candidate.slice(0, begin) +
  `  const now = Date.now();
  for (const [key, reportedAt] of reportedWarnings) {
    if (now - reportedAt >= PRELOAD_WARNING_TTL_MS) reportedWarnings.delete(key);
  }
` +
  candidate.slice(end)
)
  .replace(/^let nextWarningExpiry = Infinity;\n/m, "")
  .replace(/^\s*nextWarningExpiry = .*;\n/gm, "");
assert.ok(!baseline.includes("nextWarningExpiry"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const warning = [{ kind: "image", count: 4, budget: 1, removed: 3 }];
function runtime(arm, clock, log) {
  return new Function(
    "Date",
    "console",
    (arm === "baseline" ? baseline : candidate) +
      "\nreturn { reportFarmPreloadWarnings, clearReportedFarmPreloadWarnings, reportedWarnings };",
  )({ now: clock }, { warn: log });
}
// Differential control includes actual expiry sweeps, clock rollback, reset,
// repeated/new warnings and eviction, comparing history as well as log output.
function verify() {
  let now = 1000,
    seed = 42;
  const logs = [[], []];
  const arms = ["baseline", "candidate"].map((arm, i) =>
    runtime(
      arm,
      () => now,
      (value) => logs[i].push(value),
    ),
  );
  for (let i = 0; i < 5000; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    now += [0, 1, 59999, 60000, -70000][seed % 5];
    const input = i % 3 === 0 ? [] : warning;
    for (const api of arms) {
      if (i % 997 === 0) api.clearReportedFarmPreloadWarnings();
      api.reportFarmPreloadWarnings(input, `route /${seed % 400}`);
      assert.ok(api.reportedWarnings.size <= 256);
    }
    assert.deepEqual([...arms[0].reportedWarnings], [...arms[1].reportedWarnings]);
    assert.deepEqual(logs[0], logs[1]);
  }
}

const scenarios = {
  emptyHistory: { history: 0 },
  emptyFullHistory: { history: 256 },
  duplicateFullHistory: { history: 256, active: true },
  newWarnings: { history: 256, active: true, unique: true },
  expiredHistory: { history: 256, active: true, expire: true },
  expiredCollectedHistory: { history: 256, active: true, expire: true, collect: true },
  // One warm instance, like the single module in production: seeding stays
  // outside timing and only the expiring call is timed.
  expiredWarmHistory: { history: 256, active: true, expire: true, warm: true },
  // Amortized traffic: 32 routes, 5ms apart, a warning on every fourth response,
  // so the history expires roughly every 12,000 responses.
  steadyTraffic: { history: 0, stream: true },
};
const selected = process.env.FARM_WARNING_SCENARIO;
assert.ok(selected === undefined || Object.hasOwn(scenarios, selected));
const names = selected ? [selected] : Object.keys(scenarios);
const arm = process.argv[2];
if (arm) {
  assert.ok(["baseline", "candidate"].includes(arm));
  const name = process.argv[3];
  assert.ok(Object.hasOwn(scenarios, name));
  const scenario = scenarios[name];
  let now = 1000,
    index = 0,
    output = 0;
  const api = runtime(
    arm,
    () => now,
    () => output++,
  );
  const seedHistory = (target = api) => {
    target.clearReportedFarmPreloadWarnings();
    for (let i = 0; i < scenario.history; i++)
      target.reportFarmPreloadWarnings(warning, `route /${i}`);
  };
  const input = scenario.active ? warning : [];
  const invoke = () => {
    if (scenario.stream) {
      now += 5;
      const request = index++;
      api.reportFarmPreloadWarnings(request % 4 ? [] : warning, `route /${request % 32}`);
      return;
    }
    if (scenario.expire) {
      seedHistory();
      now += 60000;
    }
    api.reportFarmPreloadWarnings(input, scenario.unique ? `route /new-${index++}` : "route /255");
  };
  seedHistory();
  const warmups = scenario.warm ? 1000 : scenario.expire ? 100 : 20000;
  const requests = scenario.expire ? 1000 : 100000;
  for (let i = 0; i < warmups; i++) invoke();
  const samples = [];
  for (let batch = 0; batch < 5; batch++) {
    // Prepare separate histories outside timing so the expiry control measures
    // expiry itself, not the much faster insertion path hiding its cost.
    if (scenario.warm) {
      let wallNs = 0n,
        cpuMicros = 0;
      for (let i = 0; i < requests; i++) {
        seedHistory();
        now += 60000;
        const cpu = process.cpuUsage(),
          begin = process.hrtime.bigint();
        api.reportFarmPreloadWarnings(warning, "route /255");
        wallNs += process.hrtime.bigint() - begin;
        const used = process.cpuUsage(cpu);
        cpuMicros += used.user + used.system;
      }
      samples.push({ wallUs: Number(wallNs) / 1000 / requests, cpuUs: cpuMicros / requests });
      assert.ok(api.reportedWarnings.size <= 256);
      continue;
    }
    const expired = scenario.expire && !scenario.warm
      ? Array.from({ length: requests }, () => {
          const target = runtime(
            arm,
            () => now,
            () => output++,
          );
          seedHistory(target);
          return target;
        })
      : undefined;
    if (expired) now += 60000;
    // Separate control for old histories: keep the fresh-allocation control too.
    if (scenario.collect) {
      assert.equal(typeof globalThis.gc, "function");
      globalThis.gc();
    }
    const begin = performance.now(),
      cpu = process.cpuUsage();
    if (expired) {
      for (const target of expired) target.reportFarmPreloadWarnings(warning, "route /255");
    } else {
      for (let i = 0; i < requests; i++) invoke();
    }
    const used = process.cpuUsage(cpu);
    samples.push({
      wallUs: ((performance.now() - begin) * 1000) / requests,
      cpuUs: (used.user + used.system) / requests,
    });
    assert.ok(api.reportedWarnings.size <= 256);
  }
  console.log(JSON.stringify({ name, warmups, requests, output, samples }));
} else {
  verify();
  const pairs = [],
    loadBefore = os.loadavg();
  for (let round = 0; round < 5; round++)
    for (const name of names) {
      const pair = { round: round + 1, scenario: name };
      for (const current of round % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"]) {
        const child = spawnSync(
          process.execPath,
          ["--expose-gc", import.meta.filename, current, name],
          {
            encoding: "utf8",
            timeout: 60000,
          },
        );
        assert.equal(child.status, 0, child.stderr);
        pair[current] = JSON.parse(child.stdout);
      }
      assert.equal(pair.baseline.output, pair.candidate.output);
      pairs.push(pair);
    }
  const median = (values) => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
  const summary = Object.fromEntries(
    names.map((name) => [
      name,
      Object.fromEntries(
        ["baseline", "candidate"].map((current) => [
          current,
          Object.fromEntries(
            ["wallUs", "cpuUs"].map((metric) => [
              metric,
              median(
                pairs
                  .filter((p) => p.scenario === name)
                  .map(
                    (p) => p[current].samples.reduce((sum, sample) => sum + sample[metric], 0) / 5,
                  ),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  );
  console.log(
    JSON.stringify(
      {
        revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        sourceHash: hash(source),
        runnerHash: hash(readFileSync(import.meta.filename)),
        node: process.version,
        platform: process.platform,
        cpu: os.cpus()[0].model,
        loadBefore,
        loadAfter: os.loadavg(),
        methodology:
          "Reporter-only microseconds/call; 5 alternating fresh-process pairs and 5 batches/process. Fake clock isolates expiry behavior; logging is counted, not printed. expiredHistory and expiredCollectedHistory time the first sweep of 1,000 freshly compiled instances (cold code; the baseline's seeding already ran its sweep loop, the candidate's did not); only expiredCollectedHistory explicitly collects setup garbage before timing. expiredWarmHistory times the expiring call on one warm instance with seeding outside timing (per-call timers, so it includes timer overhead in both arms). steadyTraffic times 100,000 responses over 32 routes with a warning on every fourth and periodic expiry. 5000 differential steps verify logs, history, clock rollback, reset and eviction before timing. Median of process means, not SSR/network latency or a framework score.",
        sourceBytes: {
          baseline: { raw: Buffer.byteLength(baseline), gzip: gzipSync(baseline).length },
          candidate: { raw: Buffer.byteLength(candidate), gzip: gzipSync(candidate).length },
        },
        summary,
        pairs,
      },
      null,
      2,
    ),
  );
}
