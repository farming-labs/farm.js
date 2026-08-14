import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const warmupUpdates = Number(process.env.FARM_HEAVY_WARMUP || 30);
const measuredSamples = Number(process.env.FARM_HEAVY_SAMPLES || 120);
const updatesPerSample = Number(
  process.env.FARM_HEAVY_UPDATES_PER_SAMPLE || 20,
);
const basePort = Number(process.env.FARM_HEAVY_PORT || 4340);
const reportPath =
  process.env.FARM_HEAVY_REPORT || "/tmp/farm-react-heavy-benchmark.json";
const serverEntry = path.resolve(".farm/.output/server/index.mjs");
const publicChunks = path.resolve(".farm/.output/public/chunks");

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function timingSummary(samples) {
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    meanMs: total / samples.length,
    minMs: Math.min(...samples),
    maxMs: Math.max(...samples),
  };
}

async function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    let output = "";
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} ${args.join(" ")} failed.\n${output}`));
    });
  });
}

async function inspectBundle(compilerEnabled) {
  const files = (await readdir(publicChunks)).filter(
    (file) => file.startsWith("page-") && file.endsWith(".js"),
  );
  assert(files.length > 0, "The production page chunk was not emitted.");
  const sources = await Promise.all(
    files.map((file) => readFile(path.join(publicChunks, file), "utf8")),
  );
  const source = sources.join("\n");
  const heavyComponentCompiled =
    /displayName:[`"]HeavyInteractionBenchmark[`"]/.test(source);

  assert.equal(
    heavyComponentCompiled,
    compilerEnabled,
    `HeavyInteractionBenchmark compiler marker did not match compiler=${compilerEnabled}.`,
  );

  return {
    files,
    rawBytes: Buffer.byteLength(source),
    gzipBytes: gzipSync(source).byteLength,
    heavyComponentCompiled,
  };
}

async function waitForServer(server, origin, readOutput) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Production server exited early.\n${readOutput()}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Production server did not start.\n${readOutput()}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function measureTrial(browser, trial, compilerEnabled, port) {
  const mode = compilerEnabled ? "on" : "off";
  process.stdout.write(`[heavy] building compiler ${mode} (${trial})...\n`);
  await runCommand("pnpm", ["run", "build"], {
    FARM_REACT_COMPILER: String(compilerEnabled),
  });
  const bundle = await inspectBundle(compilerEnabled);

  let serverOutput = "";
  const server = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      NITRO_PORT: String(port),
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });

  const origin = `http://127.0.0.1:${port}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  page.on("pageerror", (error) => browserErrors.push(error.message));

  try {
    await waitForServer(server, origin, () => serverOutput);
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);

    const root = page.locator('[data-benchmark="heavy"]');
    await root.scrollIntoViewIfNeeded();
    assert.equal(await root.locator(".workload-cell").count(), 192);
    assert.equal(
      await root.locator(".workload-cell, .workload-cell i").count(),
      768,
    );

    const result = await page.evaluate(
      async ({ measuredSamples, updatesPerSample, warmupUpdates }) => {
        const root = document.querySelector('[data-benchmark="heavy"]');
        const button = root?.querySelector('[data-action="heavy-update"]');
        const tick = root?.querySelector('[data-metric="heavy-tick"]');
        const executions = root?.querySelector(
          '[data-metric="heavy-executions"]',
        );
        if (
          !(root instanceof HTMLElement) ||
          !(button instanceof HTMLButtonElement)
        ) {
          throw new Error("The heavy benchmark controls did not render.");
        }
        if (
          !(tick instanceof HTMLElement) ||
          !(executions instanceof HTMLElement)
        ) {
          throw new Error("The heavy benchmark metrics did not render.");
        }

        const updateOnce = () =>
          new Promise((resolve, reject) => {
            const expected = Number(tick.textContent) + 1;
            let timeout;
            const finish = () => {
              if (Number(tick.textContent) !== expected) return;
              observer.disconnect();
              clearTimeout(timeout);
              resolve();
            };
            const observer = new MutationObserver(finish);
            observer.observe(tick, {
              characterData: true,
              childList: true,
              subtree: true,
            });
            timeout = setTimeout(() => {
              observer.disconnect();
              reject(new Error(`Update ${expected} did not reach the DOM.`));
            }, 2_000);
            button.click();
            finish();
          });

        const initialExecutions = Number(executions.textContent);
        for (let index = 0; index < warmupUpdates; index += 1)
          await updateOnce();

        const samples = [];
        for (let index = 0; index < measuredSamples; index += 1) {
          const startedAt = performance.now();
          for (let update = 0; update < updatesPerSample; update += 1) {
            await updateOnce();
          }
          samples.push((performance.now() - startedAt) / updatesPerSample);
        }

        return {
          active: root.getAttribute("data-active"),
          executionsAdded: Number(executions.textContent) - initialExecutions,
          finalLevel: Number(root.getAttribute("data-level")),
          finalTick: Number(root.getAttribute("data-tick")),
          readout: root
            .querySelector('[data-metric="heavy-readout"]')
            ?.textContent?.trim(),
          samples,
        };
      },
      { measuredSamples, updatesPerSample, warmupUpdates },
    );

    const totalUpdates = warmupUpdates + measuredSamples * updatesPerSample;
    assert.equal(result.finalTick, totalUpdates);
    assert.equal(result.finalLevel, (totalUpdates * 7) % 100);
    assert.equal(result.active, String(totalUpdates % 2 === 1));
    assert.equal(result.readout, `Frame ${totalUpdates}`);
    assert.equal(result.executionsAdded, compilerEnabled ? 0 : totalUpdates);
    assert.deepEqual(browserErrors, []);

    const screenshot = `/tmp/farm-react-heavy-compiler-${mode}-${trial}.png`;
    await root.screenshot({ path: screenshot });

    return {
      compilerEnabled,
      trial,
      bundle,
      browserErrors,
      executionsAdded: result.executionsAdded,
      finalState: {
        active: result.active,
        level: result.finalLevel,
        tick: result.finalTick,
      },
      samples: result.samples,
      screenshot,
      timing: timingSummary(result.samples),
    };
  } finally {
    await context.close();
    await stopServer(server);
  }
}

const browser = await chromium.launch({ headless: true });
const browserVersion = browser.version();
let trials;
try {
  trials = [
    await measureTrial(browser, "baseline-a", false, basePort),
    await measureTrial(browser, "compiled", true, basePort + 1),
    await measureTrial(browser, "baseline-b", false, basePort + 2),
  ];
} finally {
  await browser.close();
}

const compiled = trials.find((trial) => trial.compilerEnabled);
const baselines = trials.filter((trial) => !trial.compilerEnabled);
assert(compiled);
assert.equal(baselines.length, 2);

const baselineTiming = timingSummary(
  baselines.flatMap((trial) => trial.samples),
);
const compiledTiming = timingSummary(compiled.samples);
const speedup = baselineTiming.medianMs / compiledTiming.medianMs;
const medianReductionPercent =
  ((baselineTiming.medianMs - compiledTiming.medianMs) /
    baselineTiming.medianMs) *
  100;
const p95ReductionPercent =
  ((baselineTiming.p95Ms - compiledTiming.p95Ms) / baselineTiming.p95Ms) * 100;

const report = {
  result:
    compiledTiming.medianMs < baselineTiming.medianMs ? "PASS" : "REGRESSION",
  methodology: {
    baselineTrials: 2,
    measuredSamplesPerTrial: measuredSamples,
    measuredUpdatesPerTrial: measuredSamples * updatesPerSample,
    metric: "button dispatch to observed DOM mutation",
    staticHostNodes: 768,
    updatesPerSample,
    warmupUpdatesPerTrial: warmupUpdates,
  },
  environment: {
    browser: browserVersion,
    cpu: os.cpus()[0]?.model || "unknown",
    logicalCpus: os.cpus().length,
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  },
  comparison: {
    baseline: {
      bundle: baselines[0].bundle,
      executionsAddedPerTrial: baselines.map((trial) => trial.executionsAdded),
      timing: baselineTiming,
    },
    compiler: {
      bundle: compiled.bundle,
      executionsAdded: compiled.executionsAdded,
      timing: compiledTiming,
    },
    medianReductionPercent,
    p95ReductionPercent,
    speedup,
  },
  screenshots: trials.map((trial) => trial.screenshot),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));

assert(
  compiledTiming.medianMs < baselineTiming.medianMs,
  `Compiler median ${compiledTiming.medianMs.toFixed(3)}ms did not beat baseline ${baselineTiming.medianMs.toFixed(3)}ms.`,
);
