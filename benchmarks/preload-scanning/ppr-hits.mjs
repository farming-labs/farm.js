import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Agent, get } from "node:http";
import os from "node:os";
import { performance } from "node:perf_hooks";

const [baseline, candidate, ...paths] = process.argv.slice(2);
assert.ok(
  baseline && candidate && paths.length,
  "Pass two HTTP origins and at least one PPR path.",
);
const warmups = 6;
const rounds = 30;
const arms = [baseline, candidate, baseline].map((origin) => ({
  origin,
  agent: new Agent({ keepAlive: true, maxSockets: 1 }),
}));
const orders = [
  [0, 1, 2],
  [2, 1, 0],
  [1, 2, 0],
  [0, 2, 1],
  [2, 0, 1],
  [1, 0, 2],
];
const names = ["baseline", "candidate", "baselineRepeat"];
const headers = {
  host: new URL(baseline).host,
  "accept-encoding": "identity",
  cookie: "consent=granted",
};

async function request(arm, path) {
  const start = performance.now();
  const response = await new Promise((resolve, reject) =>
    get(new URL(path, arm.origin), { agent: arm.agent, headers }, resolve).on("error", reject),
  );
  const headersMs = performance.now() - start;
  assert.equal(response.statusCode, 200);
  const chunks = [];
  for await (const chunk of response) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const html = body.toString();
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  assert.ok(heading, "Expected a docs heading on " + path);
  const htmlHints = (html.match(/<link\b[^>]*>/gi) ?? []).filter(
    (link) => /\brel=["']preload["']/i.test(link) && /\bas=["'](?:image|font)["']/i.test(link),
  );
  return {
    headersMs,
    ppr: response.headers["x-farm-ppr"],
    hash: createHash("sha256").update(body).digest("hex"),
    contract: {
      heading,
      htmlHints,
      link: response.headers.link,
      cache: response.headers["cache-control"],
    },
  };
}

const samples = [];
const expectedBodies = new Map();
const contracts = new Map();
try {
  for (let round = -warmups; round < rounds; round++) {
    for (const path of paths) {
      for (const index of orders[(round + warmups) % orders.length]) {
        const sample = await request(arms[index], path);
        if (round === -warmups) continue;
        assert.equal(sample.ppr, "hit");
        assert.equal(sample.contract.cache, "private, no-store");
        contracts.set(path, contracts.get(path) ?? sample.contract);
        assert.deepEqual(sample.contract, contracts.get(path));
        const key = arms[index].origin + path;
        expectedBodies.set(key, expectedBodies.get(key) ?? sample.hash);
        assert.equal(sample.hash, expectedBodies.get(key), "Shell changed during the run: " + key);
        if (round >= 0)
          samples.push({ path, arm: names[index], round, headersMs: sample.headersMs });
      }
    }
  }
} finally {
  for (const arm of arms) arm.agent.destroy();
}

function quantile(sorted, fraction) {
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  return sorted[lower] + (sorted[Math.ceil(index)] - sorted[lower]) * (index - lower);
}
const summary = paths.flatMap((path) =>
  names.map((arm) => {
    const times = samples
      .filter((s) => s.path === path && s.arm === arm)
      .map((s) => s.headersMs)
      .sort((a, b) => a - b);
    return { path, arm, medianMs: quantile(times, 0.5), p95Ms: quantile(times, 0.95) };
  }),
);
console.log(
  JSON.stringify(
    {
      node: process.version,
      platform: os.platform(),
      cpu: os.cpus()[0].model,
      warmups,
      rounds,
      summary,
      samples,
    },
    null,
    2,
  ),
);
