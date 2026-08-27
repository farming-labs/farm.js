import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const dashboardSamples = Number(process.env.FARM_DASHBOARD_SAMPLES || 60);
const dashboardUpdatesPerSample = Number(process.env.FARM_DASHBOARD_UPDATES || 10);
const tableSamples = Number(process.env.FARM_TABLE_SAMPLES || 10);
const warmupSamples = Number(process.env.FARM_BENCHMARK_WARMUP || 5);
const scaleCycles = Number(process.env.FARM_SCALE_CYCLES || 3);
const basePort = Number(process.env.FARM_DASHBOARD_PORT || 4380);
const reportPath = process.env.FARM_DASHBOARD_REPORT || "/tmp/farm-react-dashboard-benchmark.json";
const browserExecutablePath = process.env.FARM_EXPERIMENT_BROWSER_PATH;
const serverEntry = path.resolve(".farm/.output/server/index.mjs");
const publicChunks = path.resolve(".farm/.output/public/chunks");
const compilerReportPath = path.resolve(".farm/react-compiler.json");

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
    samples: samples.length,
  };
}

function compareTiming(baseline, candidate) {
  return {
    medianReductionPercent: ((baseline.medianMs - candidate.medianMs) / baseline.medianMs) * 100,
    p95ReductionPercent: ((baseline.p95Ms - candidate.p95Ms) / baseline.p95Ms) * 100,
    speedup: baseline.medianMs / candidate.medianMs,
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

async function inspectBuild(compilerMode) {
  const compilerEnabled = compilerMode !== "off";
  const chunkNames = (await readdir(publicChunks, { recursive: true }))
    .map(String)
    .filter((file) => file.endsWith(".js"));
  assert(chunkNames.length > 0, "The production client chunks were not emitted.");
  const sources = await Promise.all(
    chunkNames.map((file) => readFile(path.join(publicChunks, file), "utf8")),
  );
  const source = sources.join("\n");
  const dashboardCompiled = /displayName:[`"]OperationsDashboard[`"]/.test(source);
  const tableCompiled = /displayName:[`"]StandardTableBenchmark[`"]/.test(source);
  const delegatedKeyedRows =
    source.includes("delegateEvents:!0") || source.includes("delegateEvents:true");
  const configuredReactivity = compilerEnabled
    ? source.includes(`reactivity:"${compilerMode}"`) ||
      source.includes(`reactivity: "${compilerMode}"`) ||
      source.includes(`reactivity:\`${compilerMode}\``) ||
      source.includes(`reactivity: \`${compilerMode}\``)
    : false;

  assert.equal(
    dashboardCompiled,
    compilerEnabled,
    `OperationsDashboard compiler marker did not match compiler=${compilerEnabled}.`,
  );
  assert.equal(
    tableCompiled,
    compilerEnabled,
    `StandardTableBenchmark compiler marker did not match compiler=${compilerEnabled}.`,
  );
  assert.equal(
    configuredReactivity,
    compilerEnabled,
    `Compiler output did not contain reactivity=${compilerMode}.`,
  );
  assert.equal(
    delegatedKeyedRows,
    compilerEnabled,
    `Delegated keyed-row output did not match compiler=${compilerEnabled}.`,
  );

  const compilerReport = compilerEnabled
    ? JSON.parse(await readFile(compilerReportPath, "utf8"))
    : undefined;
  if (compilerReport) {
    const compiled = new Set(compilerReport.modules.flatMap((module) => module.compiled));
    assert(compiled.has("OperationsDashboard"));
    assert(compiled.has("StandardTableBenchmark"));
  }

  return {
    chunks: chunkNames,
    compilerReport: compilerReport?.summary,
    configuredReactivity,
    dashboardCompiled,
    delegatedKeyedRows,
    dynamicBindingMarkers: (source.match(/tracking:[`"]dynamic[`"]/g) || []).length,
    gzipBytes: gzipSync(source).byteLength,
    rawBytes: Buffer.byteLength(source),
    tableCompiled,
  };
}

async function waitForServer(server, origin, readOutput) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
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
  await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}

async function measureTrial(browser, trial, compilerMode, port) {
  const compilerEnabled = compilerMode !== "off";
  process.stdout.write(`[dashboard] building ${compilerMode} (${trial})...\n`);
  await rm(path.resolve(".farm"), { force: true, recursive: true });
  await runCommand("pnpm", ["run", "build"], {
    FARM_REACT_COMPILER: String(compilerEnabled),
    FARM_REACTIVITY: compilerEnabled ? compilerMode : "hybrid",
  });
  const build = await inspectBuild(compilerMode);

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
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
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
    await page.waitForTimeout(300);

    const dashboardRoot = page.locator('[data-benchmark="dashboard"]');
    const tableRoot = page.locator('[data-benchmark="table"]');
    assert.equal(await dashboardRoot.locator("[data-bar]").count(), 48);
    assert.equal(await tableRoot.locator("tbody tr").count(), 100);

    const result = await page.evaluate(
      async ({
        dashboardSamples,
        dashboardUpdatesPerSample,
        scaleCycles,
        tableSamples,
        warmupSamples,
      }) => {
        const dashboard = document.querySelector('[data-benchmark="dashboard"]');
        const table = document.querySelector('[data-benchmark="table"]');
        if (!(dashboard instanceof HTMLElement) || !(table instanceof HTMLElement)) {
          throw new Error("Benchmark roots did not render.");
        }

        const waitForMutation = (root, condition, trigger) =>
          new Promise((resolve, reject) => {
            let timeout;
            const finish = () => {
              if (!condition()) return;
              observer.disconnect();
              clearTimeout(timeout);
              resolve();
            };
            const observer = new MutationObserver(finish);
            observer.observe(root, {
              attributes: true,
              characterData: true,
              childList: true,
              subtree: true,
            });
            timeout = setTimeout(() => {
              observer.disconnect();
              reject(new Error("A benchmark action did not reach the expected DOM state."));
            }, 10_000);
            trigger();
            finish();
          });

        const requireButton = (root, selector) => {
          const button = root.querySelector(selector);
          if (!(button instanceof HTMLButtonElement)) {
            throw new Error(`Missing benchmark button ${selector}.`);
          }
          return button;
        };

        const dashboardExecutions = dashboard.querySelector('[data-metric="dashboard-executions"]');
        const tableExecutions = table.querySelector('[data-metric="table-executions"]');
        const inactiveReadout = dashboard.querySelector('[data-metric="inactive-updates"]');
        if (
          !(dashboardExecutions instanceof HTMLElement) ||
          !(tableExecutions instanceof HTMLElement) ||
          !(inactiveReadout instanceof HTMLElement)
        ) {
          throw new Error("Execution metrics did not render.");
        }

        const initialDashboardExecutions = Number(dashboardExecutions.textContent);
        const initialTableExecutions = Number(tableExecutions.textContent);
        const pulseButton = requireButton(dashboard, '[data-action="dashboard-pulse"]');
        const inactiveButton = requireButton(dashboard, '[data-action="dashboard-inactive"]');
        const toggleButton = requireButton(dashboard, '[data-action="dashboard-toggle"]');

        const ensureLive = async () => {
          if (dashboard.dataset.live === "true") return;
          await waitForMutation(
            dashboard,
            () => dashboard.dataset.live === "true",
            () => toggleButton.click(),
          );
        };

        const pulseOnce = async () => {
          const expected = Number(dashboard.dataset.revision) + 1;
          await waitForMutation(
            dashboard,
            () => Number(dashboard.dataset.revision) === expected,
            () => pulseButton.click(),
          );
        };

        const inactiveOnce = async () => {
          const expected = Number(inactiveReadout.textContent) + 1;
          await waitForMutation(
            dashboard,
            () => Number(inactiveReadout.textContent) === expected,
            () => inactiveButton.click(),
          );
        };

        const toggleOnce = async () => {
          const expected = String(dashboard.dataset.live !== "true");
          await waitForMutation(
            dashboard,
            () => dashboard.dataset.live === expected,
            () => toggleButton.click(),
          );
        };

        const measureRepeated = async (action, samples, updatesPerSample) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            for (let update = 0; update < updatesPerSample; update += 1) await action();
          }
          const timings = [];
          for (let sample = 0; sample < samples; sample += 1) {
            const startedAt = performance.now();
            for (let update = 0; update < updatesPerSample; update += 1) await action();
            timings.push((performance.now() - startedAt) / updatesPerSample);
          }
          return timings;
        };

        await ensureLive();
        const dashboardActive = await measureRepeated(
          pulseOnce,
          dashboardSamples,
          dashboardUpdatesPerSample,
        );
        await ensureLive();
        const firstBar = dashboard.querySelector('[data-bar="01"]');
        if (!(firstBar instanceof HTMLElement)) throw new Error("The first chart bar is missing.");
        const activeBarBefore = firstBar.dataset.value;
        const dashboardInactive = await measureRepeated(
          inactiveOnce,
          dashboardSamples,
          dashboardUpdatesPerSample,
        );
        const activeBarAfter = firstBar.dataset.value;
        const dashboardToggle = await measureRepeated(toggleOnce, dashboardSamples, 2);
        await ensureLive();

        const rowCount = () => table.querySelectorAll("tbody tr").length;
        const tableRevision = () => Number(table.dataset.revision);
        const tableButton = (action) => requireButton(table, `[data-action="${action}"]`);
        const runTableAction = async (action, condition) => {
          const previousRevision = tableRevision();
          await waitForMutation(
            table,
            () => tableRevision() === previousRevision + 1 && condition(),
            () => action(),
          );
        };
        const create1000 = () =>
          runTableAction(
            () => tableButton("table-create").click(),
            () => rowCount() === 1_000,
          );
        const create10000 = () =>
          runTableAction(
            () => tableButton("table-create-many").click(),
            () => rowCount() === 10_000,
          );
        const replace1000 = (firstId) =>
          runTableAction(
            () => tableButton("table-replace").click(),
            () =>
              rowCount() === 1_000 &&
              table.querySelector("tbody tr")?.getAttribute("data-row-id") !== firstId,
          );
        const clearRows = () =>
          runTableAction(
            () => tableButton("table-clear").click(),
            () => rowCount() === 0,
          );
        const ensure1000 = async () => {
          if (rowCount() === 1_000) return;
          await create1000();
        };
        const ensure10000 = async () => {
          if (rowCount() === 10_000) return;
          await create10000();
        };
        const measureTable = async (setup, action) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            await setup(sample);
            await action(sample);
          }
          const timings = [];
          for (let sample = 0; sample < tableSamples; sample += 1) {
            await setup(sample);
            const startedAt = performance.now();
            await action(sample);
            timings.push(performance.now() - startedAt);
          }
          return timings;
        };

        const tableCreate = await measureTable(
          async () => {
            if (rowCount() !== 0) await clearRows();
          },
          async () => create1000(),
        );

        const tableReplace = await measureTable(
          async () => ensure1000(),
          async () => {
            const firstId = table.querySelector("tbody tr")?.getAttribute("data-row-id");
            await replace1000(firstId);
          },
        );

        const tableCreateMany = await measureTable(
          async () => {
            if (rowCount() !== 0) await clearRows();
          },
          async () => create10000(),
        );

        const tableAppend = await measureTable(
          async () => ensure10000(),
          async () => {
            await runTableAction(
              () => tableButton("table-append").click(),
              () => rowCount() === 11_000,
            );
          },
        );

        const tableUpdate = await measureTable(
          async () => ensure10000(),
          async () => {
            const firstLabel = table.querySelector("tbody tr td:nth-child(2)")?.textContent || "";
            await runTableAction(
              () => tableButton("table-update").click(),
              () =>
                (table.querySelector("tbody tr td:nth-child(2)")?.textContent || "") ===
                `${firstLabel} !!!`,
            );
          },
        );

        const tableSwap = await measureTable(
          async () => ensure1000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const second = rows[1]?.getAttribute("data-row-id");
            const penultimate = rows[998]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-swap").click(),
              () => {
                const current = table.querySelectorAll("tbody tr");
                return (
                  current[1]?.getAttribute("data-row-id") === penultimate &&
                  current[998]?.getAttribute("data-row-id") === second
                );
              },
            );
          },
        );

        const tableSelect = await measureTable(
          async () => ensure1000(),
          async (sample) => {
            const row = table.querySelectorAll("tbody tr")[500 + (sample % 2)];
            const button = row?.querySelector('[data-action="select-row"]');
            const id = row?.getAttribute("data-row-id");
            if (!(button instanceof HTMLButtonElement) || !id) {
              throw new Error("Select-row control is missing.");
            }
            await runTableAction(
              () => button.click(),
              () => table.dataset.selected === id,
            );
          },
        );

        const tableRemove = await measureTable(
          async () => {
            if (rowCount() !== 1_000) await create1000();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const button = row?.querySelector('[data-action="remove-row"]');
            const id = row?.getAttribute("data-row-id");
            if (!(button instanceof HTMLButtonElement) || !id) {
              throw new Error("Remove-row control is missing.");
            }
            await runTableAction(
              () => button.click(),
              () => rowCount() === 999 && !table.querySelector(`[data-row-id="${id}"]`),
            );
          },
        );

        const tableClear = await measureTable(
          async () => ensure10000(),
          async () => clearRows(),
        );

        const scale = {
          appendTo20k: [],
          clear20k: [],
          create10k: [],
          remove20k: [],
          select20k: [],
          swap20k: [],
          updateEvery10th20k: [],
        };
        let peakRows = 0;
        for (let cycle = 0; cycle < scaleCycles; cycle += 1) {
          const createStartedAt = performance.now();
          await create10000();
          scale.create10k.push(performance.now() - createStartedAt);
          peakRows = Math.max(peakRows, rowCount());

          for (let expectedRows = 11_000; expectedRows <= 20_000; expectedRows += 1_000) {
            const appendStartedAt = performance.now();
            await runTableAction(
              () => tableButton("table-append").click(),
              () => rowCount() === expectedRows,
            );
            scale.appendTo20k.push(performance.now() - appendStartedAt);
            peakRows = Math.max(peakRows, rowCount());
          }

          const firstLabel = table.querySelector("tbody tr td:nth-child(2)")?.textContent || "";
          const updateStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-update").click(),
            () =>
              (table.querySelector("tbody tr td:nth-child(2)")?.textContent || "") ===
              `${firstLabel} !!!`,
          );
          scale.updateEvery10th20k.push(performance.now() - updateStartedAt);

          for (const rowIndex of [10_000 + (cycle % 2), 15_000 + (cycle % 2)]) {
            const row = table.querySelectorAll("tbody tr")[rowIndex];
            const button = row?.querySelector('[data-action="select-row"]');
            const id = row?.getAttribute("data-row-id");
            if (!(button instanceof HTMLButtonElement) || !id) {
              throw new Error("20,000-row select control is missing.");
            }
            const selectStartedAt = performance.now();
            await runTableAction(
              () => button.click(),
              () => table.dataset.selected === id,
            );
            scale.select20k.push(performance.now() - selectStartedAt);
          }

          const rowsBeforeSwap = table.querySelectorAll("tbody tr");
          const second = rowsBeforeSwap[1]?.getAttribute("data-row-id");
          const penultimate = rowsBeforeSwap[998]?.getAttribute("data-row-id");
          const swapStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-swap").click(),
            () => {
              const current = table.querySelectorAll("tbody tr");
              return (
                current[1]?.getAttribute("data-row-id") === penultimate &&
                current[998]?.getAttribute("data-row-id") === second
              );
            },
          );
          scale.swap20k.push(performance.now() - swapStartedAt);

          const removeRow = table.querySelectorAll("tbody tr")[10_000];
          const removeButton = removeRow?.querySelector('[data-action="remove-row"]');
          const removeId = removeRow?.getAttribute("data-row-id");
          if (!(removeButton instanceof HTMLButtonElement) || !removeId) {
            throw new Error("20,000-row remove control is missing.");
          }
          const removeStartedAt = performance.now();
          await runTableAction(
            () => removeButton.click(),
            () => rowCount() === 19_999 && !table.querySelector(`[data-row-id="${removeId}"]`),
          );
          scale.remove20k.push(performance.now() - removeStartedAt);

          const clearStartedAt = performance.now();
          await clearRows();
          scale.clear20k.push(performance.now() - clearStartedAt);
        }

        return {
          correctness: {
            activeBarStayedStableDuringInactiveUpdates: activeBarBefore === activeBarAfter,
            dashboardLive: dashboard.dataset.live,
            dashboardRevision: Number(dashboard.dataset.revision),
            finalTableRows: rowCount(),
            scalePeakRows: peakRows,
          },
          dashboard: {
            active: dashboardActive,
            inactive: dashboardInactive,
            toggle: dashboardToggle,
            executionsAdded: Number(dashboardExecutions.textContent) - initialDashboardExecutions,
          },
          table: {
            append: tableAppend,
            clear: tableClear,
            create: tableCreate,
            createMany: tableCreateMany,
            executionsAdded: Number(tableExecutions.textContent) - initialTableExecutions,
            remove: tableRemove,
            replace: tableReplace,
            select: tableSelect,
            swap: tableSwap,
            updateEvery10th: tableUpdate,
          },
          scale,
        };
      },
      {
        dashboardSamples,
        dashboardUpdatesPerSample,
        scaleCycles,
        tableSamples,
        warmupSamples,
      },
    );

    assert.equal(result.correctness.activeBarStayedStableDuringInactiveUpdates, true);
    assert.equal(result.correctness.dashboardLive, "true");
    assert.equal(result.correctness.finalTableRows, 0);
    assert.equal(result.correctness.scalePeakRows, 20_000);
    assert.equal(browserErrors.length, 0, browserErrors.join("\n"));
    if (compilerEnabled) {
      assert.equal(result.dashboard.executionsAdded, 0);
      assert.equal(result.table.executionsAdded, 0);
    } else {
      assert(result.dashboard.executionsAdded > 0);
      assert(result.table.executionsAdded > 0);
    }

    const screenshot = `/tmp/farm-react-dashboard-${compilerMode}-${trial}.png`;
    await page.screenshot({ path: screenshot, fullPage: false });

    return {
      browserErrors,
      build,
      compilerEnabled,
      compilerMode,
      correctness: result.correctness,
      dashboard: {
        active: timingSummary(result.dashboard.active),
        executionsAdded: result.dashboard.executionsAdded,
        inactive: timingSummary(result.dashboard.inactive),
        toggle: timingSummary(result.dashboard.toggle),
      },
      screenshot,
      scale: {
        appendTo20k: timingSummary(result.scale.appendTo20k),
        clear20k: timingSummary(result.scale.clear20k),
        create10k: timingSummary(result.scale.create10k),
        remove20k: timingSummary(result.scale.remove20k),
        select20k: timingSummary(result.scale.select20k),
        swap20k: timingSummary(result.scale.swap20k),
        updateEvery10th20k: timingSummary(result.scale.updateEvery10th20k),
      },
      table: {
        append: timingSummary(result.table.append),
        clear: timingSummary(result.table.clear),
        create: timingSummary(result.table.create),
        createMany: timingSummary(result.table.createMany),
        executionsAdded: result.table.executionsAdded,
        remove: timingSummary(result.table.remove),
        replace: timingSummary(result.table.replace),
        select: timingSummary(result.table.select),
        swap: timingSummary(result.table.swap),
        updateEvery10th: timingSummary(result.table.updateEvery10th),
      },
      trial,
    };
  } finally {
    await context.close();
    await stopServer(server);
  }
}

function combineBaseline(trials, group, metric) {
  const medians = trials.map((trial) => trial[group][metric].medianMs);
  const p95s = trials.map((trial) => trial[group][metric].p95Ms);
  const means = trials.map((trial) => trial[group][metric].meanMs);
  return {
    medianMs: medians.reduce((sum, value) => sum + value, 0) / medians.length,
    p95Ms: p95s.reduce((sum, value) => sum + value, 0) / p95s.length,
    meanMs: means.reduce((sum, value) => sum + value, 0) / means.length,
    minMs: Math.min(...trials.map((trial) => trial[group][metric].minMs)),
    maxMs: Math.max(...trials.map((trial) => trial[group][metric].maxMs)),
    samples: trials.reduce((sum, trial) => sum + trial[group][metric].samples, 0),
  };
}

function metricComparison(baselines, staticTrial, hybridTrial, group, metric) {
  const baseline = combineBaseline(baselines, group, metric);
  const staticTiming = staticTrial[group][metric];
  const hybridTiming = hybridTrial[group][metric];
  return {
    baseline,
    hybrid: hybridTiming,
    hybridVsBaseline: compareTiming(baseline, hybridTiming),
    hybridVsStatic: compareTiming(staticTiming, hybridTiming),
    static: staticTiming,
    staticVsBaseline: compareTiming(baseline, staticTiming),
  };
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

const staticTrial = trials.find((trial) => trial.compilerMode === "static");
const hybridTrial = trials.find((trial) => trial.compilerMode === "hybrid");
const baselines = trials.filter((trial) => trial.compilerMode === "off");
assert(staticTrial);
assert(hybridTrial);
assert.equal(baselines.length, 2);

const dashboardMetrics = ["active", "inactive", "toggle"];
const tableMetrics = [
  "create",
  "replace",
  "createMany",
  "append",
  "updateEvery10th",
  "select",
  "swap",
  "remove",
  "clear",
];
const scaleMetrics = [
  "create10k",
  "appendTo20k",
  "updateEvery10th20k",
  "select20k",
  "swap20k",
  "remove20k",
  "clear20k",
];
const comparisons = {
  dashboard: Object.fromEntries(
    dashboardMetrics.map((metric) => [
      metric,
      metricComparison(baselines, staticTrial, hybridTrial, "dashboard", metric),
    ]),
  ),
  table: Object.fromEntries(
    tableMetrics.map((metric) => [
      metric,
      metricComparison(baselines, staticTrial, hybridTrial, "table", metric),
    ]),
  ),
  scale: Object.fromEntries(
    scaleMetrics.map((metric) => [
      metric,
      metricComparison(baselines, staticTrial, hybridTrial, "scale", metric),
    ]),
  ),
};

const scalabilityThresholdNormalizedGrowth = 2;
const timingResolutionFloorMs = 0.25;
const scalabilityCases = [
  ["create10k", "createMany", 1],
  ["updateEvery10th20k", "updateEvery10th", 2],
  ["select20k", "select", 20],
  ["swap20k", "swap", 20],
  ["remove20k", "remove", 20],
  ["clear20k", "clear", 2],
];
const scalability = Object.fromEntries(
  scalabilityCases.map(([scaleMetric, referenceMetric, rowGrowth]) => {
    const scaleMedianMs = comparisons.scale[scaleMetric].hybrid.medianMs;
    const referenceMedianMs = comparisons.table[referenceMetric].hybrid.medianMs;
    // Sub-millisecond medians are quantized by the browser timer. Apply a small
    // floor so a 0.1 ms reference does not make the growth gate unstable while
    // still failing a clearly superlinear multi-millisecond scale regression.
    const referenceForGrowthMs = Math.max(referenceMedianMs, timingResolutionFloorMs);
    const observedGrowth = scaleMedianMs / referenceForGrowthMs;
    return [
      scaleMetric,
      {
        normalizedGrowth: observedGrowth / rowGrowth,
        observedGrowth,
        referenceForGrowthMs,
        referenceMedianMs,
        rowGrowth,
        scaleMedianMs,
      },
    ];
  }),
);
const scalabilityRegressions = Object.entries(scalability)
  .filter(([, result]) => result.normalizedGrowth > scalabilityThresholdNormalizedGrowth)
  .map(([metric, result]) => ({ metric, ...result }));

const performanceThresholdPercent = 10;
const performanceToleranceMs = 0.25;
const performanceRegressions = Object.entries(comparisons).flatMap(([group, metrics]) =>
  Object.entries(metrics)
    .filter(
      ([, comparison]) =>
        comparison.hybridVsBaseline.medianReductionPercent < -performanceThresholdPercent &&
        comparison.hybrid.medianMs - comparison.baseline.medianMs > performanceToleranceMs,
    )
    .map(([metric, comparison]) => ({
      group,
      medianReductionPercent: comparison.hybridVsBaseline.medianReductionPercent,
      metric,
      speedup: comparison.hybridVsBaseline.speedup,
    })),
);
const passed = performanceRegressions.length === 0 && scalabilityRegressions.length === 0;

const report = {
  result: passed ? "PASS" : "CORRECTNESS_PASS_PERFORMANCE_REGRESSION",
  correctness: "PASS",
  performanceGate: {
    regressions: performanceRegressions,
    status: performanceRegressions.length === 0 ? "PASS" : "FAIL",
    toleranceMs: performanceToleranceMs,
    thresholdPercent: performanceThresholdPercent,
  },
  scalabilityGate: {
    metrics: scalability,
    regressions: scalabilityRegressions,
    status: scalabilityRegressions.length === 0 ? "PASS" : "FAIL",
    timingResolutionFloorMs,
    thresholdNormalizedGrowth: scalabilityThresholdNormalizedGrowth,
  },
  methodology: {
    baselineTrials: 2,
    compilerTrials: ["static", "hybrid"],
    dashboardSamplesPerTrial: dashboardSamples,
    dashboardUpdatesPerSample,
    metric: "DOM event dispatch through asserted DOM mutation",
    standardReference: "https://github.com/krausest/js-framework-benchmark",
    scaleCycles,
    scalePeakRows: 20_000,
    tableRows: [1_000, 10_000, 11_000],
    tableSamplesPerTrial: tableSamples,
    warmupSamples,
  },
  environment: {
    browser: browserVersion,
    cpu: os.cpus()[0]?.model || "unknown",
    logicalCpus: os.cpus().length,
    node: process.version,
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  },
  comparisons,
  executionCounts: {
    baselineDashboard: baselines.map((trial) => trial.dashboard.executionsAdded),
    baselineTable: baselines.map((trial) => trial.table.executionsAdded),
    hybridDashboard: hybridTrial.dashboard.executionsAdded,
    hybridTable: hybridTrial.table.executionsAdded,
    staticDashboard: staticTrial.dashboard.executionsAdded,
    staticTable: staticTrial.table.executionsAdded,
  },
  builds: Object.fromEntries(trials.map((trial) => [trial.trial, trial.build])),
  screenshots: trials.map((trial) => trial.screenshot),
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, reportPath }, null, 2));
