import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
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
const browserExecutablePath = process.env.FARM_EXPERIMENT_BROWSER_PATH;
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

async function inspectBundle(compilerMode) {
  const compilerEnabled = compilerMode !== "off";
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
  const componentIslandCompiled =
    /displayName:[`"]ComponentIslandExperiment[`"]/.test(source);
  const configuredReactivity = compilerEnabled
    ? source.includes(`reactivity:"${compilerMode}"`) ||
      source.includes(`reactivity: "${compilerMode}"`) ||
      source.includes(`reactivity:\`${compilerMode}\``) ||
      source.includes(`reactivity: \`${compilerMode}\``)
    : false;

  assert.equal(
    heavyComponentCompiled,
    compilerEnabled,
    `HeavyInteractionBenchmark compiler marker did not match compiler=${compilerEnabled}.`,
  );
  assert.equal(
    componentIslandCompiled,
    compilerEnabled,
    `ComponentIslandExperiment compiler marker did not match compiler=${compilerEnabled}.`,
  );
  assert.equal(
    configuredReactivity,
    compilerEnabled,
    `Compiler output did not contain reactivity=${compilerMode}.`,
  );

  return {
    files,
    rawBytes: Buffer.byteLength(source),
    gzipBytes: gzipSync(source).byteLength,
    heavyComponentCompiled,
    componentIslandCompiled,
    configuredReactivity,
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

async function measureTrial(browser, trial, compilerMode, port) {
  const compilerEnabled = compilerMode !== "off";
  const mode = compilerMode;
  process.stdout.write(`[heavy] building compiler ${mode} (${trial})...\n`);
  await rm(path.resolve(".farm"), { force: true, recursive: true });
  await runCommand("pnpm", ["run", "build"], {
    FARM_REACT_COMPILER: String(compilerEnabled),
    FARM_REACTIVITY: compilerEnabled ? compilerMode : "hybrid",
  });
  const bundle = await inspectBundle(compilerMode);

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
    const islandRoot = page.locator('[data-benchmark="component-islands"]');
    assert.equal(await islandRoot.locator(".component-island-workload .workload-cell").count(), 192);
    assert.equal(
      await islandRoot.locator(
        ".component-island-workload .workload-cell, .component-island-workload .workload-cell i",
      ).count(),
      768,
    );

    const result = await page.evaluate(
      async ({ measuredSamples, updatesPerSample, warmupUpdates }) => {
        const measure = async ({ rootSelector, buttonSelector, tickSelector, executionSelector }) => {
          const root = document.querySelector(rootSelector);
          const button = root?.querySelector(buttonSelector);
          const tick = root?.querySelector(tickSelector);
          const executions = root?.querySelector(executionSelector);
          if (
            !(root instanceof HTMLElement) ||
            !(button instanceof HTMLButtonElement) ||
            !(tick instanceof HTMLElement) ||
            !(executions instanceof HTMLElement)
          ) {
            throw new Error(`Benchmark controls did not render for ${rootSelector}.`);
          }

          const staticWorkload = root.querySelector("[data-static-executions]");
          const initialStaticExecutions = Number(
            staticWorkload?.getAttribute("data-static-executions") || 0,
          );
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
          for (let index = 0; index < warmupUpdates; index += 1) await updateOnce();

          const samples = [];
          for (let index = 0; index < measuredSamples; index += 1) {
            const startedAt = performance.now();
            for (let update = 0; update < updatesPerSample; update += 1) {
              await updateOnce();
            }
            samples.push((performance.now() - startedAt) / updatesPerSample);
          }

          return {
            executionsAdded: Number(executions.textContent) - initialExecutions,
            finalTick: Number(root.getAttribute("data-tick")),
            samples,
            staticExecutionsAdded:
              Number(staticWorkload?.getAttribute("data-static-executions") || 0) -
              initialStaticExecutions,
          };
        };

        const heavy = await measure({
          rootSelector: '[data-benchmark="heavy"]',
          buttonSelector: '[data-action="heavy-update"]',
          tickSelector: '[data-metric="heavy-tick"]',
          executionSelector: '[data-metric="heavy-executions"]',
        });
        const heavyRoot = document.querySelector('[data-benchmark="heavy"]');
        const islands = await measure({
          rootSelector: '[data-benchmark="component-islands"]',
          buttonSelector: '[data-action="island-update"]',
          tickSelector: "[data-island-tick]",
          executionSelector: '[data-metric="island-owner-executions"]',
        });
        return {
          heavy: {
            ...heavy,
            active: heavyRoot?.getAttribute("data-active"),
            finalLevel: Number(heavyRoot?.getAttribute("data-level")),
            readout: heavyRoot
              ?.querySelector('[data-metric="heavy-readout"]')
              ?.textContent?.trim(),
          },
          islands,
        };
      },
      { measuredSamples, updatesPerSample, warmupUpdates },
    );

    const totalUpdates = warmupUpdates + measuredSamples * updatesPerSample;
    assert.equal(result.heavy.finalTick, totalUpdates);
    assert.equal(result.heavy.finalLevel, (totalUpdates * 7) % 100);
    assert.equal(result.heavy.active, String(totalUpdates % 2 === 1));
    assert.equal(result.heavy.readout, `Frame ${totalUpdates}`);
    assert.equal(result.heavy.executionsAdded, compilerEnabled ? 0 : totalUpdates);
    assert.equal(result.islands.finalTick, totalUpdates);
    assert.equal(result.islands.executionsAdded, compilerEnabled ? 0 : totalUpdates);
    assert.equal(result.islands.staticExecutionsAdded, compilerEnabled ? 0 : totalUpdates);
    assert.deepEqual(browserErrors, []);

    const screenshot = `/tmp/farm-react-heavy-compiler-${mode}-${trial}.png`;
    await root.screenshot({ path: screenshot });

    return {
      compilerEnabled,
      compilerMode,
      trial,
      bundle,
      browserErrors,
      executionsAdded: result.heavy.executionsAdded,
      componentIslandExecutionsAdded: result.islands.executionsAdded,
      staticComponentExecutionsAdded: result.islands.staticExecutionsAdded,
      finalState: {
        active: result.heavy.active,
        level: result.heavy.finalLevel,
        tick: result.heavy.finalTick,
      },
      samples: result.heavy.samples,
      componentIslandSamples: result.islands.samples,
      screenshot,
      timing: timingSummary(result.heavy.samples),
      componentIslandTiming: timingSummary(result.islands.samples),
    };
  } finally {
    await context.close();
    await stopServer(server);
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
});
const browserVersion = browser.version();
let trials;
try {
  trials = [
    await measureTrial(browser, "baseline-a", "off", basePort),
    await measureTrial(browser, "static", "static", basePort + 1),
    await measureTrial(browser, "hybrid", "hybrid", basePort + 2),
    await measureTrial(browser, "baseline-b", "off", basePort + 3),
  ];
} finally {
  await browser.close();
}

const staticCompiled = trials.find((trial) => trial.compilerMode === "static");
const hybridCompiled = trials.find((trial) => trial.compilerMode === "hybrid");
const baselines = trials.filter((trial) => !trial.compilerEnabled);
assert(staticCompiled);
assert(hybridCompiled);
assert.equal(baselines.length, 2);

const baselineTiming = timingSummary(
  baselines.flatMap((trial) => trial.samples),
);
const staticTiming = timingSummary(staticCompiled.samples);
const hybridTiming = timingSummary(hybridCompiled.samples);
const baselineComponentIslandTiming = timingSummary(
  baselines.flatMap((trial) => trial.componentIslandSamples),
);
const staticComponentIslandTiming = timingSummary(staticCompiled.componentIslandSamples);
const hybridComponentIslandTiming = timingSummary(hybridCompiled.componentIslandSamples);

function compareTiming(baseline, candidate) {
  return {
    medianReductionPercent:
      ((baseline.medianMs - candidate.medianMs) / baseline.medianMs) * 100,
    p95ReductionPercent: ((baseline.p95Ms - candidate.p95Ms) / baseline.p95Ms) * 100,
    speedup: baseline.medianMs / candidate.medianMs,
  };
}

const report = {
  result:
    staticTiming.medianMs < baselineTiming.medianMs &&
    hybridTiming.medianMs < baselineTiming.medianMs
      ? "PASS"
      : "REGRESSION",
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
    static: {
      bundle: staticCompiled.bundle,
      executionsAdded: staticCompiled.executionsAdded,
      timing: staticTiming,
    },
    hybrid: {
      bundle: hybridCompiled.bundle,
      executionsAdded: hybridCompiled.executionsAdded,
      timing: hybridTiming,
    },
    staticVsBaseline: compareTiming(baselineTiming, staticTiming),
    hybridVsBaseline: compareTiming(baselineTiming, hybridTiming),
    hybridVsStatic: compareTiming(staticTiming, hybridTiming),
  },
  componentIslands: {
    baseline: {
      executionsAddedPerTrial: baselines.map(
        (trial) => trial.componentIslandExecutionsAdded,
      ),
      staticComponentExecutionsAddedPerTrial: baselines.map(
        (trial) => trial.staticComponentExecutionsAdded,
      ),
      timing: baselineComponentIslandTiming,
    },
    static: {
      executionsAdded: staticCompiled.componentIslandExecutionsAdded,
      staticComponentExecutionsAdded: staticCompiled.staticComponentExecutionsAdded,
      timing: staticComponentIslandTiming,
    },
    hybrid: {
      executionsAdded: hybridCompiled.componentIslandExecutionsAdded,
      staticComponentExecutionsAdded: hybridCompiled.staticComponentExecutionsAdded,
      timing: hybridComponentIslandTiming,
    },
    staticVsBaseline: compareTiming(baselineComponentIslandTiming, staticComponentIslandTiming),
    hybridVsBaseline: compareTiming(baselineComponentIslandTiming, hybridComponentIslandTiming),
    hybridVsStatic: compareTiming(staticComponentIslandTiming, hybridComponentIslandTiming),
  },
  screenshots: trials.map((trial) => trial.screenshot),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));

assert(
  staticTiming.medianMs < baselineTiming.medianMs,
  `Static compiler median ${staticTiming.medianMs.toFixed(3)}ms did not beat baseline ${baselineTiming.medianMs.toFixed(3)}ms.`,
);
assert(
  hybridTiming.medianMs < baselineTiming.medianMs,
  `Hybrid compiler median ${hybridTiming.medianMs.toFixed(3)}ms did not beat baseline ${baselineTiming.medianMs.toFixed(3)}ms.`,
);
assert(
  staticComponentIslandTiming.medianMs < baselineComponentIslandTiming.medianMs,
  `Static component-island median ${staticComponentIslandTiming.medianMs.toFixed(3)}ms did not beat baseline ${baselineComponentIslandTiming.medianMs.toFixed(3)}ms.`,
);
assert(
  hybridComponentIslandTiming.medianMs < baselineComponentIslandTiming.medianMs,
  `Hybrid component-island median ${hybridComponentIslandTiming.medianMs.toFixed(3)}ms did not beat baseline ${baselineComponentIslandTiming.medianMs.toFixed(3)}ms.`,
);
