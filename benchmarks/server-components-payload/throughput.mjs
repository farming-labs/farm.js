// Documents per second from each server components engine, in alternating rounds so both see the
// same machine. timing.mjs runs one engine after the other, which favors whichever ran when the
// machine was quieter.
//
//   node benchmarks/server-components-payload/throughput.mjs [--rounds 8]
//
// Uses the production builds measure.mjs leaves in app/.farm.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.join(here, "app");
const roundsFlag = process.argv.indexOf("--rounds");
const ROUNDS = roundsFlag === -1 ? 8 : Number(process.argv[roundsFlag + 1]);
const SECONDS = 5;
const CONCURRENCY = 16;
const SECTIONS = { docs: "/docs/p", shop: "/shop/s", blog: "/blog/b" };

async function serve(mode, port) {
  const child = spawn(
    process.execPath,
    [path.join(app, ".farm", `.output-${mode}`, "server", "index.mjs")],
    {
      cwd: app,
      env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port) },
      stdio: "ignore",
    },
  );
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(`${url}/docs/p0`)).ok) return { mode, url, stop: () => child.kill() };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error(`${mode} server did not start`);
}

async function requestsPerSecond(server, prefix) {
  let next = 0;
  let completed = 0;
  const deadline = Date.now() + SECONDS * 1000;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (Date.now() < deadline) {
        const pathname = `${prefix}${next++ % 100}`;
        const response = await fetch(server.url + pathname);
        await response.arrayBuffer();
        if (response.status !== 200) {
          throw new Error(`${server.mode}: ${pathname} returned ${response.status}`);
        }
        completed++;
      }
    }),
  );
  return Math.round(completed / SECONDS);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarize = (values) => `${median(values)} (${Math.min(...values)}-${Math.max(...values)})`;

const rsc = await serve("rsc", 4391);
const islands = await serve("islands", 4392);
const rows = [];
try {
  for (const [section, prefix] of Object.entries(SECTIONS)) {
    for (const server of [rsc, islands]) {
      for (let index = 0; index < 100; index++) {
        await (await fetch(`${server.url}${prefix}${index}`)).arrayBuffer();
      }
    }
    const samples = { rsc: [], islands: [] };
    for (let round = 0; round < ROUNDS; round++) {
      for (const server of round % 2 ? [islands, rsc] : [rsc, islands]) {
        samples[server.mode].push(await requestsPerSecond(server, prefix));
      }
    }
    rows.push({
      section,
      "rsc req/s": summarize(samples.rsc),
      "islands req/s": summarize(samples.islands),
      "islands / rsc": (median(samples.islands) / median(samples.rsc)).toFixed(2),
    });
  }
} finally {
  rsc.stop();
  islands.stop();
}
console.log(
  `Median (range) of ${ROUNDS} alternating rounds of ${SECONDS} s, ${CONCURRENCY} at a time.`,
);
console.table(rows);
