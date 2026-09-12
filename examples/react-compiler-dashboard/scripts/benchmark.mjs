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
    assert(
      compilerReport.summary.keyedIdentityTargets > 0,
      "The compiler build did not emit a key-directed row-binding target.",
    );
    assert(
      compilerReport.summary.keyedMembershipTargets > 0,
      "The compiler build did not emit a keyed Set-membership target.",
    );
    assert(
      compilerReport.summary.keyedMapLookupTargets > 0,
      "The compiler build did not emit a keyed Map-lookup target.",
    );
    assert(
      compilerReport.summary.keyedMapUpdateHints >= 24,
      "The compiler build did not emit every single-map, consecutive-map, and map-reorder hint.",
    );
    assert(
      compilerReport.summary.keyedArrayAppendHints > 0,
      "The compiler build did not emit a keyed-array append hint.",
    );
    assert(
      compilerReport.summary.keyedArrayFilterHints >= 3,
      "The compiler build did not emit every keyed-array filter hint.",
    );
    assert(
      compilerReport.summary.keyedArrayPrependHints > 0,
      "The compiler build did not emit a keyed-array prepend hint.",
    );
    assert(
      compilerReport.summary.keyedArrayPositionHints >= 15,
      "The compiler build did not emit the keyed-array exact-position hints.",
    );
    assert(
      compilerReport.summary.keyedArrayReorderHints >= 17,
      "The compiler build did not emit every native keyed-array reorder pipeline step.",
    );
    assert(
      compilerReport.summary.keyedArraySortHints > 0,
      "The compiler build did not emit a keyed-array sort hint.",
    );
    assert(
      compilerReport.summary.keyedArrayRollingWindowHints >= 6,
      "The compiler build did not emit every keyed-array rolling-window hint.",
    );
    assert(
      compilerReport.summary.keyedArrayMappedRollingWindowChainHints >= 2,
      "The compiler build did not emit the mapped rolling-window chain hint.",
    );
    assert(
      compilerReport.summary.keyedArraySliceHints > 0,
      "The compiler build did not emit a keyed-array slice hint.",
    );
    assert(
      compilerReport.summary.keyedCollectionUpdateHints > 0,
      "The compiler build did not emit a keyed Set/Map collection-delta hint.",
    );
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
              const operation = table.querySelector('[data-metric="table-operation"]')?.textContent;
              const rows = table.querySelectorAll("tbody tr").length;
              reject(
                new Error(
                  `A benchmark action did not reach the expected DOM state (operation: ${operation || "unknown"}, rows: ${rows}).`,
                ),
              );
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
        const rowsMatch = (current, previous) => {
          if (current.length !== previous.length) return false;
          for (let index = 0; index < current.length; index += 1) {
            if (current[index] !== previous[index]) return false;
          }
          return true;
        };
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
        const seedDenseTargets = async () => {
          const expected = rowCount();
          const middle = table.querySelectorAll("tbody tr")[Math.floor(expected / 2)];
          if (!middle) throw new Error("Dense-target row is missing.");
          await runTableAction(
            () => tableButton("table-seed-dense-targets").click(),
            () =>
              Number(table.dataset.markedCount) === expected &&
              Number(table.dataset.queueCount) === expected &&
              middle.getAttribute("data-marked") === "true" &&
              middle.getAttribute("data-queue") === "dense" &&
              middle.getAttribute("data-snapshot-marked") === "true" &&
              middle.getAttribute("data-snapshot-queue") === "dense",
          );
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

        const tableAppendSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            await runTableAction(
              () => tableButton("table-append-snapshot").click(),
              () => rowCount() === 11_000,
            );
          },
        );

        const tablePrepend = await measureTable(
          async () => ensure10000(),
          async () => {
            const previousFirstRow = table.querySelector("tbody tr");
            const previousFirst = previousFirstRow?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-prepend").click(),
              () =>
                rowCount() === 11_000 &&
                table.querySelector("tbody tr")?.getAttribute("data-row-id") !== previousFirst &&
                table.querySelectorAll("tbody tr")[1_000] === previousFirstRow,
            );
          },
        );

        const tablePrependSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const previousFirstRow = table.querySelector("tbody tr");
            const previousFirst = previousFirstRow?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-prepend-snapshot").click(),
              () =>
                rowCount() === 11_000 &&
                table.querySelector("tbody tr")?.getAttribute("data-row-id") !== previousFirst &&
                table.querySelectorAll("tbody tr")[1_000] === previousFirstRow,
            );
          },
        );

        const tableSlicePrefix = await measureTable(
          async () => ensure10000(),
          async () => {
            const firstSurvivor = table.querySelectorAll("tbody tr")[1_000];
            await runTableAction(
              () => tableButton("table-drop-prefix").click(),
              () => rowCount() === 9_000 && table.querySelector("tbody tr") === firstSurvivor,
            );
          },
        );

        const tableSlicePrefixSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const firstSurvivor = table.querySelectorAll("tbody tr")[1_000];
            await runTableAction(
              () => tableButton("table-drop-prefix-snapshot").click(),
              () => rowCount() === 9_000 && table.querySelector("tbody tr") === firstSurvivor,
            );
          },
        );

        const tableRollingWindow = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const tableRollingWindowSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window-snapshot").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const tableMappedRollingWindow = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousText = firstSurvivor?.textContent;
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window-map").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                firstSurvivor?.textContent !== previousText &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const tableMappedRollingWindowSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousText = firstSurvivor?.textContent;
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window-map-snapshot").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                firstSurvivor?.textContent !== previousText &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const measureMappedRollingWindowChain = async (action) => {
          const rows = table.querySelectorAll("tbody tr");
          const reviewedSurvivor = rows[100];
          const escalatedSurvivor = rows[101];
          const secondaryReviewedSurvivor = rows[102];
          const reviewedLabel = reviewedSurvivor?.querySelector("td:nth-child(2)")?.textContent;
          const escalatedLabel = escalatedSurvivor?.querySelector("td:nth-child(2)")?.textContent;
          const secondaryReviewedLabel = secondaryReviewedSurvivor
            ?.querySelector("td:nth-child(2)")
            ?.textContent;
          const reviewedAmount = Number(
            reviewedSurvivor?.querySelector("td:nth-child(4)")?.textContent?.slice(1),
          );
          const escalatedAmount = Number(
            escalatedSurvivor?.querySelector("td:nth-child(4)")?.textContent?.slice(1),
          );
          const secondaryReviewedAmount = Number(
            secondaryReviewedSurvivor?.querySelector("td:nth-child(4)")?.textContent?.slice(1),
          );
          const previousLast = rows[9_999]?.getAttribute("data-row-id");
          if (
            !reviewedSurvivor ||
            !escalatedSurvivor ||
            !secondaryReviewedSurvivor ||
            !reviewedLabel ||
            !escalatedLabel ||
            !secondaryReviewedLabel ||
            !Number.isFinite(reviewedAmount) ||
            !Number.isFinite(escalatedAmount) ||
            !Number.isFinite(secondaryReviewedAmount)
          ) {
            throw new Error("Mapped rolling-chain source rows are invalid.");
          }
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              rowCount() === 10_000 &&
              nextRows[0] === reviewedSurvivor &&
              nextRows[1] === escalatedSurvivor &&
              nextRows[2] === secondaryReviewedSurvivor &&
              reviewedSurvivor.querySelector("td:nth-child(2)")?.textContent ===
                `${reviewedLabel} reviewed` &&
              reviewedSurvivor.querySelector("td:nth-child(4)")?.textContent ===
                `$${reviewedAmount + 1}` &&
              escalatedSurvivor.querySelector("td:nth-child(2)")?.textContent ===
                `${escalatedLabel} escalated` &&
              escalatedSurvivor.querySelector("td:nth-child(4)")?.textContent ===
                `$${escalatedAmount + 2}` &&
              secondaryReviewedSurvivor.querySelector("td:nth-child(2)")?.textContent ===
                `${secondaryReviewedLabel} reviewed` &&
              secondaryReviewedSurvivor.querySelector("td:nth-child(4)")?.textContent ===
                `$${secondaryReviewedAmount + 1}` &&
              nextRows[9_999]?.getAttribute("data-row-id") !== previousLast
            );
          });
        };

        const tableMappedRollingWindowChain = await measureTable(
          async () => ensure10000(),
          async () =>
            measureMappedRollingWindowChain(() =>
              tableButton("table-roll-window-map-chain").click(),
            ),
        );

        const tableMappedRollingWindowChainSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureMappedRollingWindowChain(() =>
              tableButton("table-roll-window-map-chain-snapshot").click(),
            ),
        );

        const tableRollingWindowQueued = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window-queued").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const tableRollingWindowQueuedSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const firstSurvivor = rows[1_000];
            const previousLast = rows[9_999]?.getAttribute("data-row-id");
            await runTableAction(
              () => tableButton("table-roll-window-queued-snapshot").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelector("tbody tr") === firstSurvivor &&
                table.querySelector("tbody tr:last-child")?.getAttribute("data-row-id") !==
                  previousLast,
            );
          },
        );

        const tablePositionInsert = await measureTable(
          async () => ensure10000(),
          async () => {
            const previousAtPosition = table.querySelectorAll("tbody tr")[9_000];
            await runTableAction(
              () => tableButton("table-position-insert").click(),
              () =>
                rowCount() === 10_001 &&
                table.querySelectorAll("tbody tr")[9_001] === previousAtPosition,
            );
          },
        );

        const tablePositionInsertSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const previousAtPosition = table.querySelectorAll("tbody tr")[9_000];
            await runTableAction(
              () => tableButton("table-position-insert-snapshot").click(),
              () =>
                rowCount() === 10_001 &&
                table.querySelectorAll("tbody tr")[9_001] === previousAtPosition,
            );
          },
        );

        const tablePositionBatchInsert = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[4_999];
            const previousAtPosition = rows[5_000];
            await runTableAction(
              () => tableButton("table-position-batch-insert").click(),
              () =>
                rowCount() === 10_064 &&
                table.querySelectorAll("tbody tr")[4_999] === before &&
                table.querySelectorAll("tbody tr")[5_064] === previousAtPosition,
            );
          },
        );

        const tablePositionBatchInsertSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[4_999];
            const previousAtPosition = rows[5_000];
            await runTableAction(
              () => tableButton("table-position-batch-insert-snapshot").click(),
              () =>
                rowCount() === 10_064 &&
                table.querySelectorAll("tbody tr")[4_999] === before &&
                table.querySelectorAll("tbody tr")[5_064] === previousAtPosition,
            );
          },
        );

        const tablePositionWindowReplace = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[4_999];
            const firstRemoved = rows[5_000];
            const lastRemoved = rows[5_063];
            const after = rows[5_064];
            await runTableAction(
              () => tableButton("table-position-window-replace").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelectorAll("tbody tr")[4_999] === before &&
                table.querySelectorAll("tbody tr")[5_064] === after &&
                !firstRemoved?.isConnected &&
                !lastRemoved?.isConnected,
            );
          },
        );

        const tablePositionWindowReplaceSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[4_999];
            const firstRemoved = rows[5_000];
            const lastRemoved = rows[5_063];
            const after = rows[5_064];
            await runTableAction(
              () => tableButton("table-position-window-replace-snapshot").click(),
              () =>
                rowCount() === 10_000 &&
                table.querySelectorAll("tbody tr")[4_999] === before &&
                table.querySelectorAll("tbody tr")[5_064] === after &&
                !firstRemoved?.isConnected &&
                !lastRemoved?.isConnected,
            );
          },
        );

        const measureWindowReuse = async (
          action,
          { expectedRows, windowEnd, afterIndex, labelSuffix },
        ) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const previousRows = new Set(rows);
          const before = rows[2_499];
          const windowRows = rows.slice(2_500, 2_564);
          const after = rows[2_564];
          const retained = windowRows.slice(0, 48).reverse();
          const retired = windowRows.slice(48);
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            const nextWindow = [...nextRows].slice(2_500, windowEnd);
            return (
              rowCount() === expectedRows &&
              nextRows[2_499] === before &&
              nextRows[afterIndex] === after &&
              retained.every(
                (row, offset) =>
                  nextWindow[offset] === row &&
                  row.children[1]?.textContent?.endsWith(labelSuffix),
              ) &&
              retired.every((row) => !row.isConnected) &&
              nextWindow.slice(48).every((row) => !previousRows.has(row))
            );
          });
        };

        const tablePositionWindowReuse = await measureTable(
          async () => ensure10000(),
          async () =>
            measureWindowReuse(() => tableButton("table-position-window-reuse").click(), {
              expectedRows: 10_000,
              windowEnd: 2_564,
              afterIndex: 2_564,
              labelSuffix: " retained",
            }),
        );

        const tablePositionWindowReuseSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureWindowReuse(
              () => tableButton("table-position-window-reuse-snapshot").click(),
              {
                expectedRows: 10_000,
                windowEnd: 2_564,
                afterIndex: 2_564,
                labelSuffix: " retained",
              },
            ),
        );

        const tablePositionWindowResizeReuse = await measureTable(
          async () => ensure10000(),
          async () =>
            measureWindowReuse(
              () => tableButton("table-position-window-resize-reuse").click(),
              {
                expectedRows: 10_016,
                windowEnd: 2_580,
                afterIndex: 2_580,
                labelSuffix: " resized",
              },
            ),
        );

        const tablePositionWindowResizeReuseSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureWindowReuse(
              () => tableButton("table-position-window-resize-reuse-snapshot").click(),
              {
                expectedRows: 10_016,
                windowEnd: 2_580,
                afterIndex: 2_580,
                labelSuffix: " resized",
              },
            ),
        );

        const measureQueuedWindowResize = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const previousRows = new Set(rows);
          const firstBefore = rows[2_499];
          const firstWindow = rows.slice(2_500, 2_564);
          const firstAfter = rows[2_564];
          const firstRetained = firstWindow.slice(0, 48).reverse();
          const firstRetired = firstWindow.slice(48);
          const secondBefore = rows[7_499];
          const secondWindow = rows.slice(7_500, 7_564);
          const secondAfter = rows[7_564];
          const secondRetained = secondWindow.slice(0, 32).reverse();
          const secondRetired = secondWindow.slice(32);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const firstNextWindow = nextRows.slice(2_500, 2_580);
            const secondNextWindow = nextRows.slice(7_516, 7_564);
            return (
              rowCount() === 10_000 &&
              nextRows[2_499] === firstBefore &&
              nextRows[2_580] === firstAfter &&
              nextRows[7_515] === secondBefore &&
              nextRows[7_564] === secondAfter &&
              firstRetained.every(
                (row, offset) =>
                  firstNextWindow[offset] === row &&
                  row.children[1]?.textContent?.endsWith(" queued grow"),
              ) &&
              secondRetained.every(
                (row, offset) =>
                  secondNextWindow[offset] === row &&
                  row.children[1]?.textContent?.endsWith(" queued shrink"),
              ) &&
              firstRetired.every((row) => !row.isConnected) &&
              secondRetired.every((row) => !row.isConnected) &&
              firstNextWindow.slice(48).every((row) => !previousRows.has(row)) &&
              secondNextWindow.slice(32).every((row) => !previousRows.has(row))
            );
          });
        };

        const tablePositionWindowResizeQueued = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowResize(() =>
              tableButton("table-position-window-resize-queued").click(),
            ),
        );

        const tablePositionWindowResizeQueuedSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowResize(() =>
              tableButton("table-position-window-resize-queued-snapshot").click(),
            ),
        );

        const tablePositionWindowRefresh = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const retained = [...rows].slice(5_000, 5_064);
            const changedLabel = retained[32]?.children[1]?.textContent;
            const changedAmount = retained[32]?.children[3]?.textContent;
            await runTableAction(
              () => tableButton("table-position-window-refresh").click(),
              () => {
                const nextRows = table.querySelectorAll("tbody tr");
                return (
                  rowCount() === 10_000 &&
                  retained.every((row, offset) => nextRows[5_000 + offset] === row) &&
                  nextRows[5_032]?.children[1]?.textContent === `${changedLabel} refreshed` &&
                  nextRows[5_032]?.children[3]?.textContent !== changedAmount
                );
              },
            );
          },
        );

        const tablePositionWindowRefreshSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const retained = [...rows].slice(5_000, 5_064);
            const changedLabel = retained[32]?.children[1]?.textContent;
            const changedAmount = retained[32]?.children[3]?.textContent;
            await runTableAction(
              () => tableButton("table-position-window-refresh-snapshot").click(),
              () => {
                const nextRows = table.querySelectorAll("tbody tr");
                return (
                  rowCount() === 10_000 &&
                  retained.every((row, offset) => nextRows[5_000 + offset] === row) &&
                  nextRows[5_032]?.children[1]?.textContent === `${changedLabel} refreshed` &&
                  nextRows[5_032]?.children[3]?.textContent !== changedAmount
                );
              },
            );
          },
        );

        const measureQueuedWindowRefresh = async (action) => {
          const rows = table.querySelectorAll("tbody tr");
          const firstRetained = [...rows].slice(2_500, 2_532);
          const secondRetained = [...rows].slice(7_500, 7_532);
          const firstLabel = firstRetained[16]?.children[1]?.textContent;
          const firstAmount = firstRetained[16]?.children[3]?.textContent;
          const secondLabel = secondRetained[16]?.children[1]?.textContent;
          const secondAmount = secondRetained[16]?.children[3]?.textContent;
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              rowCount() === 10_000 &&
              firstRetained.every((row, offset) => nextRows[2_500 + offset] === row) &&
              secondRetained.every((row, offset) => nextRows[7_500 + offset] === row) &&
              nextRows[2_516]?.children[1]?.textContent === `${firstLabel} queued` &&
              nextRows[2_516]?.children[3]?.textContent !== firstAmount &&
              nextRows[7_516]?.children[1]?.textContent === `${secondLabel} queued` &&
              nextRows[7_516]?.children[3]?.textContent !== secondAmount
            );
          });
        };

        const tablePositionWindowRefreshQueued = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowRefresh(() =>
              tableButton("table-position-window-refresh-queued").click(),
            ),
        );

        const tablePositionWindowRefreshQueuedSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowRefresh(() =>
              tableButton("table-position-window-refresh-queued-snapshot").click(),
            ),
        );

        const measureQueuedWindowReplacement = async (action) => {
          const rows = table.querySelectorAll("tbody tr");
          const removed = [...rows].slice(2_500, 2_548);
          const before = rows[2_499];
          const after = rows[2_548];
          const firstOldKey = removed[8]?.getAttribute("data-row-id");
          const secondOldKey = removed[32]?.getAttribute("data-row-id");
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              rowCount() === 10_000 &&
              nextRows[2_499] === before &&
              nextRows[2_548] === after &&
              removed.every((row, offset) =>
                Boolean(!row.isConnected && nextRows[2_500 + offset] !== row),
              ) &&
              nextRows[2_508]?.getAttribute("data-row-id") !== firstOldKey &&
              nextRows[2_532]?.getAttribute("data-row-id") !== secondOldKey &&
              nextRows[2_508]?.children[1]?.textContent?.endsWith(" queued replacement") &&
              nextRows[2_532]?.children[1]?.textContent?.endsWith(" queued replacement")
            );
          });
        };

        const tablePositionWindowReplaceQueued = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowReplacement(() =>
              tableButton("table-position-window-replace-queued").click(),
            ),
        );

        const tablePositionWindowReplaceQueuedSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureQueuedWindowReplacement(() =>
              tableButton("table-position-window-replace-queued-snapshot").click(),
            ),
        );

        const tablePositionRemove = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[8_999];
            const removed = rows[9_000];
            const after = rows[9_001];
            await runTableAction(
              () => tableButton("table-position-remove").click(),
              () =>
                rowCount() === 9_999 &&
                table.querySelectorAll("tbody tr")[8_999] === before &&
                table.querySelectorAll("tbody tr")[9_000] === after &&
                !removed?.isConnected,
            );
          },
        );

        const tablePositionRemoveSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[8_999];
            const removed = rows[9_000];
            const after = rows[9_001];
            await runTableAction(
              () => tableButton("table-position-remove-snapshot").click(),
              () =>
                rowCount() === 9_999 &&
                table.querySelectorAll("tbody tr")[8_999] === before &&
                table.querySelectorAll("tbody tr")[9_000] === after &&
                !removed?.isConnected,
            );
          },
        );

        const tablePositionRangeRemove = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[7_999];
            const firstRemoved = rows[8_000];
            const lastRemoved = rows[8_063];
            const after = rows[8_064];
            await runTableAction(
              () => tableButton("table-position-range-remove").click(),
              () =>
                rowCount() === 9_936 &&
                table.querySelectorAll("tbody tr")[7_999] === before &&
                table.querySelectorAll("tbody tr")[8_000] === after &&
                !firstRemoved?.isConnected &&
                !lastRemoved?.isConnected,
            );
          },
        );

        const tablePositionRangeRemoveSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const before = rows[7_999];
            const firstRemoved = rows[8_000];
            const lastRemoved = rows[8_063];
            const after = rows[8_064];
            await runTableAction(
              () => tableButton("table-position-range-remove-snapshot").click(),
              () =>
                rowCount() === 9_936 &&
                table.querySelectorAll("tbody tr")[7_999] === before &&
                table.querySelectorAll("tbody tr")[8_000] === after &&
                !firstRemoved?.isConnected &&
                !lastRemoved?.isConnected,
            );
          },
        );

        const tablePositionReplace = await measureTable(
          async () => ensure10000(),
          async () => {
            const row = table.querySelectorAll("tbody tr")[100];
            const label = row?.querySelector("td:nth-child(2)")?.textContent || "";
            await runTableAction(
              () => tableButton("table-position-replace").click(),
              () =>
                table.querySelectorAll("tbody tr")[100] === row &&
                row?.querySelector("td:nth-child(2)")?.textContent === `${label} @`,
            );
          },
        );

        const tablePositionReplaceSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const row = table.querySelectorAll("tbody tr")[100];
            const label = row?.querySelector("td:nth-child(2)")?.textContent || "";
            await runTableAction(
              () => tableButton("table-position-replace-snapshot").click(),
              () =>
                table.querySelectorAll("tbody tr")[100] === row &&
                row?.querySelector("td:nth-child(2)")?.textContent === `${label} @`,
            );
          },
        );

        const tableReverse = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const first = rows[0];
            const last = rows[9_999];
            await runTableAction(
              () => tableButton("table-reverse").click(),
              () => {
                const current = table.querySelectorAll("tbody tr");
                return current[0] === last && current[9_999] === first;
              },
            );
          },
        );

        const tableReverseSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            const first = rows[0];
            const last = rows[9_999];
            await runTableAction(
              () => tableButton("table-reverse-snapshot").click(),
              () => {
                const current = table.querySelectorAll("tbody tr");
                return current[0] === last && current[9_999] === first;
              },
            );
          },
        );

        const tableReverseQueued = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            await runTableAction(
              () => tableButton("table-reverse-queued").click(),
              () => rowsMatch(table.querySelectorAll("tbody tr"), rows),
            );
          },
        );

        const tableReverseQueuedSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            await runTableAction(
              () => tableButton("table-reverse-queued-snapshot").click(),
              () => rowsMatch(table.querySelectorAll("tbody tr"), rows),
            );
          },
        );

        const tableReversePipeline = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            await runTableAction(
              () => tableButton("table-reverse-pipeline").click(),
              () => rowsMatch(table.querySelectorAll("tbody tr"), rows),
            );
          },
        );

        const tableReversePipelineSnapshot = await measureTable(
          async () => ensure10000(),
          async () => {
            const rows = table.querySelectorAll("tbody tr");
            await runTableAction(
              () => tableButton("table-reverse-pipeline-snapshot").click(),
              () => rowsMatch(table.querySelectorAll("tbody tr"), rows),
            );
          },
        );

        const measureFilterReorderPipeline = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const survivors = rows.filter(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 !== 5_001,
          );
          const removed = rows.filter(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              nextRows.length === survivors.length &&
              rowsMatch(nextRows, survivors) &&
              removed.every((row) => !row.isConnected)
            );
          });
        };

        const tableFilterReorderPipeline = await measureTable(
          async () => ensure10000(),
          async () =>
            measureFilterReorderPipeline(() =>
              tableButton("table-filter-reorder-pipeline").click(),
            ),
        );

        const tableFilterReorderPipelineSnapshot = await measureTable(
          async () => ensure10000(),
          async () =>
            measureFilterReorderPipeline(() =>
              tableButton("table-filter-reorder-pipeline-snapshot").click(),
            ),
        );

        const measureStructuralAppend = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 7_001,
          );
          if (!removed) throw new Error("Queued structural-append source row is missing.");
          const survivors = rows.filter((row) => row !== removed);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const appended = nextRows.at(-1);
            return (
              nextRows.length === 10_000 &&
              rowsMatch(nextRows.slice(0, -1), survivors) &&
              appended?.querySelector("td:nth-child(2)")?.textContent === "queued incoming row" &&
              !rows.includes(appended) &&
              !removed.isConnected
            );
          });
        };

        const tableStructuralAppendQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralAppend(() =>
              tableButton("table-structural-append-queued").click(),
            ),
        );

        const tableStructuralAppendQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralAppend(() =>
              tableButton("table-structural-append-queued-snapshot").click(),
            ),
        );

        const measureStructuralPrepend = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows[0];
          if (!removed) throw new Error("Queued structural-prepend source row is missing.");
          const survivors = rows.slice(1);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const prepended = nextRows[0];
            return (
              nextRows.length === 10_000 &&
              prepended?.querySelector("td:nth-child(2)")?.textContent ===
                "queued prepended row" &&
              !rows.includes(prepended) &&
              rowsMatch(nextRows.slice(1), survivors) &&
              !removed.isConnected
            );
          });
        };

        const tableStructuralPrependQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralPrepend(() =>
              tableButton("table-structural-prepend-queued").click(),
            ),
        );

        const tableStructuralPrependQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralPrepend(() =>
              tableButton("table-structural-prepend-queued-snapshot").click(),
            ),
        );

        const measureStructuralPrependMap = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows[0];
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const amount = Number(target?.querySelector("td:nth-child(4)")?.textContent?.slice(1));
          if (!removed || !target || !Number.isFinite(amount)) {
            throw new Error("Queued structural-prepend-map source rows are invalid.");
          }
          const survivors = rows.slice(1);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const prepended = nextRows[0];
            return (
              nextRows.length === 10_000 &&
              prepended?.querySelector("td:nth-child(2)")?.textContent ===
                "queued mapped prepended row" &&
              !rows.includes(prepended) &&
              rowsMatch(nextRows.slice(1), survivors) &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount + 1}` &&
              !removed.isConnected
            );
          });
        };

        const tableStructuralPrependMapQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralPrependMap(() =>
              tableButton("table-structural-prepend-map-queued").click(),
            ),
        );

        const tableStructuralPrependMapQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralPrependMap(() =>
              tableButton("table-structural-prepend-map-queued-snapshot").click(),
            ),
        );

        const measureStructuralAppendMap = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows[0];
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const amount = Number(target?.querySelector("td:nth-child(4)")?.textContent?.slice(1));
          if (!removed || !target || !Number.isFinite(amount)) {
            throw new Error("Queued structural-append-map source rows are invalid.");
          }
          const survivors = rows.slice(1);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const appended = nextRows.at(-1);
            return (
              nextRows.length === 10_000 &&
              rowsMatch(nextRows.slice(0, -1), survivors) &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount + 1}` &&
              appended?.querySelector("td:nth-child(2)")?.textContent ===
                "queued mapped incoming row" &&
              !rows.includes(appended) &&
              !removed.isConnected
            );
          });
        };

        const tableStructuralAppendMapQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralAppendMap(() =>
              tableButton("table-structural-append-map-queued").click(),
            ),
        );

        const tableStructuralAppendMapQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureStructuralAppendMap(() =>
              tableButton("table-structural-append-map-queued-snapshot").click(),
            ),
        );

        const measureFilterAppendMap = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 7_001,
          );
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const amount = Number(target?.querySelector("td:nth-child(4)")?.textContent?.slice(1));
          if (!removed || !target || !Number.isFinite(amount)) {
            throw new Error("Queued filter-append-map source rows are invalid.");
          }
          const survivors = rows.filter((row) => row !== removed);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const appended = nextRows.at(-1);
            return (
              nextRows.length === 10_000 &&
              rowsMatch(nextRows.slice(0, -1), survivors) &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount + 1}` &&
              appended?.querySelector("td:nth-child(2)")?.textContent ===
                "queued filter mapped incoming row" &&
              !rows.includes(appended) &&
              !removed.isConnected
            );
          });
        };

        const tableFilterAppendMapQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureFilterAppendMap(() => tableButton("table-filter-append-map-queued").click()),
        );

        const tableFilterAppendMapQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureFilterAppendMap(() =>
              tableButton("table-filter-append-map-queued-snapshot").click(),
            ),
        );

        const measureFilterMapAppend = async (action) => {
          const rows = [...table.querySelectorAll("tbody tr")];
          const removed = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 7_001,
          );
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const amount = Number(target?.querySelector("td:nth-child(4)")?.textContent?.slice(1));
          if (!removed || !target || !Number.isFinite(amount)) {
            throw new Error("Queued filter-map-append source rows are invalid.");
          }
          const survivors = rows.filter((row) => row !== removed);
          await runTableAction(action, () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            const appended = nextRows.at(-1);
            return (
              nextRows.length === 10_000 &&
              rowsMatch(nextRows.slice(0, -1), survivors) &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount + 1}` &&
              appended?.querySelector("td:nth-child(2)")?.textContent ===
                "queued mapped-before-append row" &&
              !rows.includes(appended) &&
              !removed.isConnected
            );
          });
        };

        const tableFilterMapAppendQueued = await measureTable(
          async () => create10000(),
          async () =>
            measureFilterMapAppend(() => tableButton("table-filter-map-append-queued").click()),
        );

        const tableFilterMapAppendQueuedSnapshot = await measureTable(
          async () => create10000(),
          async () =>
            measureFilterMapAppend(() =>
              tableButton("table-filter-map-append-queued-snapshot").click(),
            ),
        );

        const prepareMapStructuralReorderPipeline = async () => {
          await create10000();
          const rows = [...table.querySelectorAll("tbody tr")];
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const removed = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 7_001,
          );
          const amount = Number(target?.querySelector("td:nth-child(4)")?.textContent?.slice(1));
          if (!target || !removed || !Number.isFinite(amount)) {
            throw new Error("Mapped terminal-structural source rows are invalid.");
          }
          return {
            amount: amount + 1,
            expectedRows: rows.filter((row) => row !== removed),
            removed,
            rows,
            target,
          };
        };

        const measureMapStructuralReorderPipeline = async (action, prepared) => {
          const { amount, expectedRows, removed, rows, target } = prepared;
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              nextRows.length === 9_999 &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount}` &&
              !removed.isConnected
            );
          });
          return () => {
            const nextRows = table.querySelectorAll("tbody tr");
            if (
              !rowsMatch(nextRows, expectedRows) ||
              rows.some((row) => row !== removed && !row.isConnected)
            ) {
              throw new Error(
                "Mapped terminal-structural rows do not match the expected filtered order.",
              );
            }
          };
        };

        const measureMapStructuralReorderTable = async (action) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            const verify = await measureMapStructuralReorderPipeline(
              action,
              await prepareMapStructuralReorderPipeline(),
            );
            verify();
          }
          const timings = [];
          for (let sample = 0; sample < tableSamples; sample += 1) {
            const prepared = await prepareMapStructuralReorderPipeline();
            const startedAt = performance.now();
            const verify = await measureMapStructuralReorderPipeline(action, prepared);
            timings.push(performance.now() - startedAt);
            verify();
          }
          return timings;
        };

        const tableMapStructuralReorderPipeline = await measureMapStructuralReorderTable(() =>
          tableButton("table-map-structural-reorder-pipeline").click(),
        );

        const tableMapStructuralReorderPipelineSnapshot =
          await measureMapStructuralReorderTable(() =>
            tableButton("table-map-structural-reorder-pipeline-snapshot").click(),
          );

        const prepareMapReorderPipeline = async (expectedAmount) => {
          await create10000();
          const rows = [...table.querySelectorAll("tbody tr")];
          const orderedRows = rows.map((row) => {
            const id = Number(row.getAttribute("data-row-id"));
            const amountText = row.querySelector("td:nth-child(4)")?.textContent;
            const amount = Number(amountText?.slice(1));
            if (!Number.isFinite(id) || !Number.isFinite(amount)) {
              throw new Error("Map-reorder source row is invalid.");
            }
            return {
              amount: id % 10_000 === 5_001 ? expectedAmount : amount,
              id,
              row,
            };
          });
          orderedRows.sort((left, right) => left.amount - right.amount || left.id - right.id);
          const target = orderedRows.find(({ id }) => id % 10_000 === 5_001)?.row;
          if (!target) throw new Error("Map-reorder target row is missing.");
          return { expectedRows: orderedRows.map(({ row }) => row), rows, target };
        };

        const measureMapReorderPipeline = async (
          action,
          prepared,
          expectedLabelSuffix = " repriced",
          expectedAmount = -1,
        ) => {
          if (!prepared) throw new Error("Map-reorder expectation is missing.");
          const { expectedRows, rows, target } = prepared;
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              nextRows.length === 10_000 &&
              nextRows[0] === target &&
              target
                .querySelector("td:nth-child(2)")
                ?.textContent?.endsWith(expectedLabelSuffix) === true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${expectedAmount}`
            );
          });
          return () => {
            const nextRows = table.querySelectorAll("tbody tr");
            if (
              nextRows.length !== 10_000 ||
              !rowsMatch(nextRows, expectedRows) ||
              rows.some((row) => !row.isConnected)
            ) {
              throw new Error("Map-reorder rows do not match the complete expected permutation.");
            }
          };
        };

        const measureMapReorderTable = async (
          action,
          expectedAmount,
          expectedLabelSuffix = " repriced",
        ) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            const prepared = await prepareMapReorderPipeline(expectedAmount);
            const verify = await measureMapReorderPipeline(
              action,
              prepared,
              expectedLabelSuffix,
              expectedAmount,
            );
            verify();
          }
          const timings = [];
          for (let sample = 0; sample < tableSamples; sample += 1) {
            const prepared = await prepareMapReorderPipeline(expectedAmount);
            const startedAt = performance.now();
            const verify = await measureMapReorderPipeline(
              action,
              prepared,
              expectedLabelSuffix,
              expectedAmount,
            );
            timings.push(performance.now() - startedAt);
            verify();
          }
          return timings;
        };

        const tableMapReorderPipeline = await measureMapReorderTable(
          () => tableButton("table-map-reorder-pipeline").click(),
          -1,
        );

        const tableMapReorderPipelineSnapshot = await measureMapReorderTable(
          () => tableButton("table-map-reorder-pipeline-snapshot").click(),
          -1,
        );

        const tableMultiMapReorderPipeline = await measureMapReorderTable(
          () => tableButton("table-multi-map-reorder-pipeline").click(),
          -2,
          " reviewed",
        );

        const tableMultiMapReorderPipelineSnapshot = await measureMapReorderTable(
          () => tableButton("table-multi-map-reorder-pipeline-snapshot").click(),
          -2,
          " reviewed",
        );

        const prepareMultiMapReversePipeline = async (reverseRows = true) => {
          await create10000();
          const rows = [...table.querySelectorAll("tbody tr")];
          const target = rows.find(
            (row) => Number(row.getAttribute("data-row-id")) % 10_000 === 5_001,
          );
          const amountText = target?.querySelector("td:nth-child(4)")?.textContent;
          const amount = Number(amountText?.slice(1));
          if (!target || !Number.isFinite(amount)) {
            throw new Error("Mapped-reverse target row is invalid.");
          }
          return {
            expectedRows: reverseRows ? [...rows].reverse() : rows,
            rows,
            target,
            amount: amount + 1,
          };
        };

        const measureMultiMapReversePipeline = async (action, prepared) => {
          if (!prepared) throw new Error("Mapped-reverse expectation is missing.");
          const { expectedRows, rows, target, amount } = prepared;
          await runTableAction(action, () => {
            const nextRows = table.querySelectorAll("tbody tr");
            return (
              nextRows.length === 10_000 &&
              nextRows[0] === expectedRows[0] &&
              target.querySelector("td:nth-child(2)")?.textContent?.endsWith(" reviewed") ===
                true &&
              target.querySelector("td:nth-child(4)")?.textContent === `$${amount}`
            );
          });
          return () => {
            const nextRows = table.querySelectorAll("tbody tr");
            if (!rowsMatch(nextRows, expectedRows) || rows.some((row) => !row.isConnected)) {
              throw new Error("Mapped-reverse rows do not match the complete expected reversal.");
            }
          };
        };

        const measureMultiMapReverseTable = async (action, reverseRows = true) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            const verify = await measureMultiMapReversePipeline(
              action,
              await prepareMultiMapReversePipeline(reverseRows),
            );
            verify();
          }
          const timings = [];
          for (let sample = 0; sample < tableSamples; sample += 1) {
            const prepared = await prepareMultiMapReversePipeline(reverseRows);
            const startedAt = performance.now();
            const verify = await measureMultiMapReversePipeline(action, prepared);
            timings.push(performance.now() - startedAt);
            verify();
          }
          return timings;
        };

        const tableMultiMapReversePipeline = await measureMultiMapReverseTable(() =>
          tableButton("table-multi-map-reverse-pipeline").click(),
        );
        const tableMultiMapReversePipelineSnapshot = await measureMultiMapReverseTable(() =>
          tableButton("table-multi-map-reverse-pipeline-snapshot").click(),
        );
        const tableMultiMapReverseParity = await measureMultiMapReverseTable(
          () => tableButton("table-multi-map-reverse-parity").click(),
          false,
        );
        const tableMultiMapReverseParitySnapshot = await measureMultiMapReverseTable(
          () => tableButton("table-multi-map-reverse-parity-snapshot").click(),
          false,
        );
        const tableQueuedMapReverseParity = await measureMultiMapReverseTable(
          () => tableButton("table-queued-map-reverse-parity").click(),
          false,
        );
        const tableQueuedMapReverseParitySnapshot = await measureMultiMapReverseTable(
          () => tableButton("table-queued-map-reverse-parity-snapshot").click(),
          false,
        );
        const tableReorderThenMapPipeline = await measureMultiMapReverseTable(() =>
          tableButton("table-reorder-then-map-pipeline").click(),
        );
        const tableReorderThenMapPipelineSnapshot = await measureMultiMapReverseTable(() =>
          tableButton("table-reorder-then-map-pipeline-snapshot").click(),
        );
        const tableQueuedReorderThenMapPipeline = await measureMultiMapReverseTable(() =>
          tableButton("table-queued-reorder-then-map-pipeline").click(),
        );
        const tableQueuedReorderThenMapPipelineSnapshot = await measureMultiMapReverseTable(() =>
          tableButton("table-queued-reorder-then-map-pipeline-snapshot").click(),
        );
        const tableQueuedMapThenReorderPipeline = await measureMultiMapReverseTable(() =>
          tableButton("table-queued-map-then-reorder-pipeline").click(),
        );
        const tableQueuedMapThenReorderPipelineSnapshot = await measureMultiMapReverseTable(() =>
          tableButton("table-queued-map-then-reorder-pipeline-snapshot").click(),
        );
        const tableQueuedMapReorderChain = await measureMultiMapReverseTable(
          () => tableButton("table-queued-map-reorder-chain").click(),
          false,
        );
        const tableQueuedMapReorderChainSnapshot = await measureMultiMapReverseTable(
          () => tableButton("table-queued-map-reorder-chain-snapshot").click(),
          false,
        );

        const tableSort = await measureTable(
          async () => create10000(),
          async () => {
            const first = table.querySelector("tbody tr");
            await runTableAction(
              () => tableButton("table-sort").click(),
              () => rowCount() === 10_000 && table.querySelector("tbody tr") !== first,
            );
          },
        );

        const tableSortSnapshot = await measureTable(
          async () => create10000(),
          async () => {
            const first = table.querySelector("tbody tr");
            await runTableAction(
              () => tableButton("table-sort-snapshot").click(),
              () => rowCount() === 10_000 && table.querySelector("tbody tr") !== first,
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

        const prepareMultiMapUpdate = async () => {
          await create10000();
          const rows = [...table.querySelectorAll("tbody tr")];
          const expected = rows.map((row, index) => {
            const label = row.querySelector("td:nth-child(2)")?.textContent;
            const amountText = row.querySelector("td:nth-child(4)")?.textContent;
            const amount = Number(amountText?.slice(1));
            if (label === undefined || !Number.isFinite(amount)) {
              throw new Error("Multi-map source row is invalid.");
            }
            return {
              amount: index % 10 === 0 ? amount + 1 : amount,
              label: index % 10 === 0 ? `${label} reviewed` : label,
              row,
            };
          });
          return { expected, rows };
        };

        const runMultiMapUpdate = async (action, prepared) => {
          if (!prepared) throw new Error("Multi-map expectation is missing.");
          const first = prepared.expected[0];
          await runTableAction(action, () => {
            const row = table.querySelector("tbody tr");
            return (
              row === first.row &&
              row.querySelector("td:nth-child(2)")?.textContent === first.label &&
              row.querySelector("td:nth-child(4)")?.textContent === `$${first.amount}`
            );
          });
          return () => {
            const nextRows = [...table.querySelectorAll("tbody tr")];
            if (nextRows.length !== prepared.expected.length) {
              throw new Error("Multi-map row count changed.");
            }
            for (let index = 0; index < prepared.expected.length; index += 1) {
              const expected = prepared.expected[index];
              const row = nextRows[index];
              if (
                row !== expected.row ||
                !row.isConnected ||
                row.querySelector("td:nth-child(2)")?.textContent !== expected.label ||
                row.querySelector("td:nth-child(4)")?.textContent !== `$${expected.amount}`
              ) {
                throw new Error(`Multi-map row ${index} did not match its expected update.`);
              }
            }
          };
        };

        const measureMultiMapUpdate = async (action) => {
          for (let sample = 0; sample < warmupSamples; sample += 1) {
            const prepared = await prepareMultiMapUpdate();
            const verify = await runMultiMapUpdate(action, prepared);
            verify();
          }
          const timings = [];
          for (let sample = 0; sample < tableSamples; sample += 1) {
            const prepared = await prepareMultiMapUpdate();
            const startedAt = performance.now();
            const verify = await runMultiMapUpdate(action, prepared);
            timings.push(performance.now() - startedAt);
            verify();
          }
          return timings;
        };

        const tableMultiMapUpdate = await measureMultiMapUpdate(() =>
          tableButton("table-multi-map-update").click(),
        );
        const tableMultiMapUpdateSnapshot = await measureMultiMapUpdate(() =>
          tableButton("table-multi-map-update-snapshot").click(),
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

        const tableMembership = await measureTable(
          async () => ensure1000(),
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-marked");
            if (!row) throw new Error("Membership target row is missing.");
            await runTableAction(
              () => tableButton("table-mark").click(),
              () => row.getAttribute("data-marked") !== previous,
            );
          },
        );

        const tableMapLookup = await measureTable(
          async () => ensure1000(),
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-queue");
            if (!row) throw new Error("Map lookup target row is missing.");
            await runTableAction(
              () => tableButton("table-queue").click(),
              () => row.getAttribute("data-queue") !== previous,
            );
          },
        );

        const tableDenseMembership = await measureTable(
          async () => {
            await ensure1000();
            await seedDenseTargets();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-marked");
            if (!row) throw new Error("Dense membership target row is missing.");
            await runTableAction(
              () => tableButton("table-toggle-dense-mark").click(),
              () => row.getAttribute("data-marked") !== previous,
            );
          },
        );

        const tableDenseMapLookup = await measureTable(
          async () => {
            await ensure1000();
            await seedDenseTargets();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-queue");
            if (!row) throw new Error("Dense Map target row is missing.");
            await runTableAction(
              () => tableButton("table-update-dense-queue").click(),
              () => row.getAttribute("data-queue") !== previous,
            );
          },
        );

        const tableSnapshotMembership = await measureTable(
          async () => {
            await ensure1000();
            await seedDenseTargets();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-snapshot-marked");
            if (!row) throw new Error("Snapshot membership target row is missing.");
            await runTableAction(
              () => tableButton("table-toggle-snapshot-mark").click(),
              () => row.getAttribute("data-snapshot-marked") !== previous,
            );
          },
        );

        const tableSnapshotMapLookup = await measureTable(
          async () => {
            await ensure1000();
            await seedDenseTargets();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const previous = row?.getAttribute("data-snapshot-queue");
            if (!row) throw new Error("Snapshot Map target row is missing.");
            await runTableAction(
              () => tableButton("table-update-snapshot-queue").click(),
              () => row.getAttribute("data-snapshot-queue") !== previous,
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

        const tableRemoveSnapshot = await measureTable(
          async () => {
            if (rowCount() !== 1_000) await create1000();
          },
          async () => {
            const row = table.querySelectorAll("tbody tr")[500];
            const id = row?.getAttribute("data-row-id");
            if (!id) throw new Error("Snapshot remove target is missing.");
            await runTableAction(
              () => tableButton("table-remove-snapshot").click(),
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
          denseMapLookup20k: [],
          denseMembership20k: [],
          mapLookup20k: [],
          membership20k: [],
          prependAt20k: [],
          remove20k: [],
          select20k: [],
          snapshotMapLookup20k: [],
          snapshotMembership20k: [],
          slicePrefixAt21k: [],
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

          const previousFirstRow = table.querySelector("tbody tr");
          const previousFirst = previousFirstRow?.getAttribute("data-row-id");
          const prependStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-prepend").click(),
            () =>
              rowCount() === 21_000 &&
              table.querySelector("tbody tr")?.getAttribute("data-row-id") !== previousFirst &&
              table.querySelectorAll("tbody tr")[1_000] === previousFirstRow,
          );
          scale.prependAt20k.push(performance.now() - prependStartedAt);
          peakRows = Math.max(peakRows, rowCount());
          const sliceStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-drop-prefix").click(),
            () => rowCount() === 20_000 && table.querySelector("tbody tr") === previousFirstRow,
          );
          scale.slicePrefixAt21k.push(performance.now() - sliceStartedAt);

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

          const membershipRow = table.querySelectorAll("tbody tr")[10_000];
          const previousMembership = membershipRow?.getAttribute("data-marked");
          if (!membershipRow) throw new Error("20,000-row membership target is missing.");
          const membershipStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-mark").click(),
            () => membershipRow.getAttribute("data-marked") !== previousMembership,
          );
          scale.membership20k.push(performance.now() - membershipStartedAt);

          const mapLookupRow = table.querySelectorAll("tbody tr")[10_000];
          const previousMapLookup = mapLookupRow?.getAttribute("data-queue");
          if (!mapLookupRow) throw new Error("20,000-row Map lookup target is missing.");
          const mapLookupStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-queue").click(),
            () => mapLookupRow.getAttribute("data-queue") !== previousMapLookup,
          );
          scale.mapLookup20k.push(performance.now() - mapLookupStartedAt);

          await seedDenseTargets();
          const denseTarget = table.querySelectorAll("tbody tr")[10_000];
          if (!denseTarget) throw new Error("20,000-row dense target is missing.");

          const previousDenseMembership = denseTarget.getAttribute("data-marked");
          const denseMembershipStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-toggle-dense-mark").click(),
            () => denseTarget.getAttribute("data-marked") !== previousDenseMembership,
          );
          scale.denseMembership20k.push(performance.now() - denseMembershipStartedAt);

          const previousDenseMapLookup = denseTarget.getAttribute("data-queue");
          const denseMapLookupStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-update-dense-queue").click(),
            () => denseTarget.getAttribute("data-queue") !== previousDenseMapLookup,
          );
          scale.denseMapLookup20k.push(performance.now() - denseMapLookupStartedAt);

          const previousSnapshotMembership = denseTarget.getAttribute("data-snapshot-marked");
          const snapshotMembershipStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-toggle-snapshot-mark").click(),
            () =>
              denseTarget.getAttribute("data-snapshot-marked") !== previousSnapshotMembership,
          );
          scale.snapshotMembership20k.push(performance.now() - snapshotMembershipStartedAt);

          const previousSnapshotMapLookup = denseTarget.getAttribute("data-snapshot-queue");
          const snapshotMapLookupStartedAt = performance.now();
          await runTableAction(
            () => tableButton("table-update-snapshot-queue").click(),
            () => denseTarget.getAttribute("data-snapshot-queue") !== previousSnapshotMapLookup,
          );
          scale.snapshotMapLookup20k.push(performance.now() - snapshotMapLookupStartedAt);

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
            finalMarkedCount: Number(table.dataset.markedCount),
            finalQueueCount: Number(table.dataset.queueCount),
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
            appendSnapshot: tableAppendSnapshot,
            clear: tableClear,
            create: tableCreate,
            createMany: tableCreateMany,
            denseMapLookup: tableDenseMapLookup,
            denseMembership: tableDenseMembership,
            executionsAdded: Number(tableExecutions.textContent) - initialTableExecutions,
            filterReorderPipeline: tableFilterReorderPipeline,
            filterReorderPipelineSnapshot: tableFilterReorderPipelineSnapshot,
            filterAppendMapQueued: tableFilterAppendMapQueued,
            filterAppendMapQueuedSnapshot: tableFilterAppendMapQueuedSnapshot,
            filterMapAppendQueued: tableFilterMapAppendQueued,
            filterMapAppendQueuedSnapshot: tableFilterMapAppendQueuedSnapshot,
            structuralAppendQueued: tableStructuralAppendQueued,
            structuralAppendQueuedSnapshot: tableStructuralAppendQueuedSnapshot,
            structuralPrependQueued: tableStructuralPrependQueued,
            structuralPrependQueuedSnapshot: tableStructuralPrependQueuedSnapshot,
            structuralPrependMapQueued: tableStructuralPrependMapQueued,
            structuralPrependMapQueuedSnapshot: tableStructuralPrependMapQueuedSnapshot,
            structuralAppendMapQueued: tableStructuralAppendMapQueued,
            structuralAppendMapQueuedSnapshot: tableStructuralAppendMapQueuedSnapshot,
            mapStructuralReorderPipeline: tableMapStructuralReorderPipeline,
            mapStructuralReorderPipelineSnapshot: tableMapStructuralReorderPipelineSnapshot,
            mapReorderPipeline: tableMapReorderPipeline,
            mapReorderPipelineSnapshot: tableMapReorderPipelineSnapshot,
            multiMapUpdate: tableMultiMapUpdate,
            multiMapUpdateSnapshot: tableMultiMapUpdateSnapshot,
            multiMapReorderPipeline: tableMultiMapReorderPipeline,
            multiMapReorderPipelineSnapshot: tableMultiMapReorderPipelineSnapshot,
            multiMapReversePipeline: tableMultiMapReversePipeline,
            multiMapReversePipelineSnapshot: tableMultiMapReversePipelineSnapshot,
            multiMapReverseParity: tableMultiMapReverseParity,
            multiMapReverseParitySnapshot: tableMultiMapReverseParitySnapshot,
            queuedMapReverseParity: tableQueuedMapReverseParity,
            queuedMapReverseParitySnapshot: tableQueuedMapReverseParitySnapshot,
            reorderThenMapPipeline: tableReorderThenMapPipeline,
            reorderThenMapPipelineSnapshot: tableReorderThenMapPipelineSnapshot,
            queuedReorderThenMapPipeline: tableQueuedReorderThenMapPipeline,
            queuedReorderThenMapPipelineSnapshot: tableQueuedReorderThenMapPipelineSnapshot,
            queuedMapThenReorderPipeline: tableQueuedMapThenReorderPipeline,
            queuedMapThenReorderPipelineSnapshot: tableQueuedMapThenReorderPipelineSnapshot,
            queuedMapReorderChain: tableQueuedMapReorderChain,
            queuedMapReorderChainSnapshot: tableQueuedMapReorderChainSnapshot,
            mapLookup: tableMapLookup,
            membership: tableMembership,
            prepend: tablePrepend,
            prependSnapshot: tablePrependSnapshot,
            positionBatchInsert: tablePositionBatchInsert,
            positionBatchInsertSnapshot: tablePositionBatchInsertSnapshot,
            positionWindowReplace: tablePositionWindowReplace,
            positionWindowReplaceQueued: tablePositionWindowReplaceQueued,
            positionWindowReplaceQueuedSnapshot: tablePositionWindowReplaceQueuedSnapshot,
            positionWindowReplaceSnapshot: tablePositionWindowReplaceSnapshot,
            positionWindowReuse: tablePositionWindowReuse,
            positionWindowReuseSnapshot: tablePositionWindowReuseSnapshot,
            positionWindowResizeReuse: tablePositionWindowResizeReuse,
            positionWindowResizeReuseSnapshot: tablePositionWindowResizeReuseSnapshot,
            positionWindowResizeQueued: tablePositionWindowResizeQueued,
            positionWindowResizeQueuedSnapshot: tablePositionWindowResizeQueuedSnapshot,
            positionWindowRefresh: tablePositionWindowRefresh,
            positionWindowRefreshQueued: tablePositionWindowRefreshQueued,
            positionWindowRefreshQueuedSnapshot: tablePositionWindowRefreshQueuedSnapshot,
            positionWindowRefreshSnapshot: tablePositionWindowRefreshSnapshot,
            positionInsert: tablePositionInsert,
            positionInsertSnapshot: tablePositionInsertSnapshot,
            positionRemove: tablePositionRemove,
            positionRemoveSnapshot: tablePositionRemoveSnapshot,
            positionRangeRemove: tablePositionRangeRemove,
            positionRangeRemoveSnapshot: tablePositionRangeRemoveSnapshot,
            positionReplace: tablePositionReplace,
            positionReplaceSnapshot: tablePositionReplaceSnapshot,
            reverse: tableReverse,
            reversePipeline: tableReversePipeline,
            reversePipelineSnapshot: tableReversePipelineSnapshot,
            reverseQueued: tableReverseQueued,
            reverseQueuedSnapshot: tableReverseQueuedSnapshot,
            reverseSnapshot: tableReverseSnapshot,
            sort: tableSort,
            sortSnapshot: tableSortSnapshot,
            remove: tableRemove,
            removeSnapshot: tableRemoveSnapshot,
            replace: tableReplace,
            mappedRollingWindow: tableMappedRollingWindow,
            mappedRollingWindowChain: tableMappedRollingWindowChain,
            mappedRollingWindowChainSnapshot: tableMappedRollingWindowChainSnapshot,
            mappedRollingWindowSnapshot: tableMappedRollingWindowSnapshot,
            rollingWindow: tableRollingWindow,
            rollingWindowQueued: tableRollingWindowQueued,
            rollingWindowQueuedSnapshot: tableRollingWindowQueuedSnapshot,
            rollingWindowSnapshot: tableRollingWindowSnapshot,
            select: tableSelect,
            snapshotMapLookup: tableSnapshotMapLookup,
            snapshotMembership: tableSnapshotMembership,
            slicePrefix: tableSlicePrefix,
            slicePrefixSnapshot: tableSlicePrefixSnapshot,
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
    assert.equal(result.correctness.finalMarkedCount, 0);
    assert.equal(result.correctness.finalQueueCount, 0);
    assert.equal(result.correctness.finalTableRows, 0);
    assert.equal(result.correctness.scalePeakRows, 21_000);
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
        denseMapLookup20k: timingSummary(result.scale.denseMapLookup20k),
        denseMembership20k: timingSummary(result.scale.denseMembership20k),
        mapLookup20k: timingSummary(result.scale.mapLookup20k),
        membership20k: timingSummary(result.scale.membership20k),
        prependAt20k: timingSummary(result.scale.prependAt20k),
        remove20k: timingSummary(result.scale.remove20k),
        select20k: timingSummary(result.scale.select20k),
        snapshotMapLookup20k: timingSummary(result.scale.snapshotMapLookup20k),
        snapshotMembership20k: timingSummary(result.scale.snapshotMembership20k),
        slicePrefixAt21k: timingSummary(result.scale.slicePrefixAt21k),
        swap20k: timingSummary(result.scale.swap20k),
        updateEvery10th20k: timingSummary(result.scale.updateEvery10th20k),
      },
      table: {
        append: timingSummary(result.table.append),
        appendSnapshot: timingSummary(result.table.appendSnapshot),
        clear: timingSummary(result.table.clear),
        create: timingSummary(result.table.create),
        createMany: timingSummary(result.table.createMany),
        denseMapLookup: timingSummary(result.table.denseMapLookup),
        denseMembership: timingSummary(result.table.denseMembership),
        executionsAdded: result.table.executionsAdded,
        filterReorderPipeline: timingSummary(result.table.filterReorderPipeline),
        filterReorderPipelineSnapshot: timingSummary(result.table.filterReorderPipelineSnapshot),
        filterAppendMapQueued: timingSummary(result.table.filterAppendMapQueued),
        filterAppendMapQueuedSnapshot: timingSummary(result.table.filterAppendMapQueuedSnapshot),
        filterMapAppendQueued: timingSummary(result.table.filterMapAppendQueued),
        filterMapAppendQueuedSnapshot: timingSummary(result.table.filterMapAppendQueuedSnapshot),
        structuralAppendQueued: timingSummary(result.table.structuralAppendQueued),
        structuralAppendQueuedSnapshot: timingSummary(result.table.structuralAppendQueuedSnapshot),
        structuralPrependQueued: timingSummary(result.table.structuralPrependQueued),
        structuralPrependQueuedSnapshot: timingSummary(
          result.table.structuralPrependQueuedSnapshot,
        ),
        structuralPrependMapQueued: timingSummary(result.table.structuralPrependMapQueued),
        structuralPrependMapQueuedSnapshot: timingSummary(
          result.table.structuralPrependMapQueuedSnapshot,
        ),
        structuralAppendMapQueued: timingSummary(result.table.structuralAppendMapQueued),
        structuralAppendMapQueuedSnapshot: timingSummary(
          result.table.structuralAppendMapQueuedSnapshot,
        ),
        mapStructuralReorderPipeline: timingSummary(result.table.mapStructuralReorderPipeline),
        mapStructuralReorderPipelineSnapshot: timingSummary(
          result.table.mapStructuralReorderPipelineSnapshot,
        ),
        mapReorderPipeline: timingSummary(result.table.mapReorderPipeline),
        mapReorderPipelineSnapshot: timingSummary(result.table.mapReorderPipelineSnapshot),
        multiMapUpdate: timingSummary(result.table.multiMapUpdate),
        multiMapUpdateSnapshot: timingSummary(result.table.multiMapUpdateSnapshot),
        multiMapReorderPipeline: timingSummary(result.table.multiMapReorderPipeline),
        multiMapReorderPipelineSnapshot: timingSummary(
          result.table.multiMapReorderPipelineSnapshot,
        ),
        multiMapReversePipeline: timingSummary(result.table.multiMapReversePipeline),
        multiMapReversePipelineSnapshot: timingSummary(
          result.table.multiMapReversePipelineSnapshot,
        ),
        multiMapReverseParity: timingSummary(result.table.multiMapReverseParity),
        multiMapReverseParitySnapshot: timingSummary(result.table.multiMapReverseParitySnapshot),
        queuedMapReverseParity: timingSummary(result.table.queuedMapReverseParity),
        queuedMapReverseParitySnapshot: timingSummary(result.table.queuedMapReverseParitySnapshot),
        reorderThenMapPipeline: timingSummary(result.table.reorderThenMapPipeline),
        reorderThenMapPipelineSnapshot: timingSummary(
          result.table.reorderThenMapPipelineSnapshot,
        ),
        queuedReorderThenMapPipeline: timingSummary(result.table.queuedReorderThenMapPipeline),
        queuedReorderThenMapPipelineSnapshot: timingSummary(
          result.table.queuedReorderThenMapPipelineSnapshot,
        ),
        queuedMapThenReorderPipeline: timingSummary(result.table.queuedMapThenReorderPipeline),
        queuedMapThenReorderPipelineSnapshot: timingSummary(
          result.table.queuedMapThenReorderPipelineSnapshot,
        ),
        queuedMapReorderChain: timingSummary(result.table.queuedMapReorderChain),
        queuedMapReorderChainSnapshot: timingSummary(result.table.queuedMapReorderChainSnapshot),
        mapLookup: timingSummary(result.table.mapLookup),
        membership: timingSummary(result.table.membership),
        prepend: timingSummary(result.table.prepend),
        prependSnapshot: timingSummary(result.table.prependSnapshot),
        positionBatchInsert: timingSummary(result.table.positionBatchInsert),
        positionBatchInsertSnapshot: timingSummary(result.table.positionBatchInsertSnapshot),
        positionWindowReplace: timingSummary(result.table.positionWindowReplace),
        positionWindowReplaceQueued: timingSummary(result.table.positionWindowReplaceQueued),
        positionWindowReplaceQueuedSnapshot: timingSummary(
          result.table.positionWindowReplaceQueuedSnapshot,
        ),
        positionWindowReplaceSnapshot: timingSummary(
          result.table.positionWindowReplaceSnapshot,
        ),
        positionWindowReuse: timingSummary(result.table.positionWindowReuse),
        positionWindowReuseSnapshot: timingSummary(result.table.positionWindowReuseSnapshot),
        positionWindowResizeReuse: timingSummary(result.table.positionWindowResizeReuse),
        positionWindowResizeReuseSnapshot: timingSummary(
          result.table.positionWindowResizeReuseSnapshot,
        ),
        positionWindowResizeQueued: timingSummary(result.table.positionWindowResizeQueued),
        positionWindowResizeQueuedSnapshot: timingSummary(
          result.table.positionWindowResizeQueuedSnapshot,
        ),
        positionWindowRefresh: timingSummary(result.table.positionWindowRefresh),
        positionWindowRefreshQueued: timingSummary(result.table.positionWindowRefreshQueued),
        positionWindowRefreshQueuedSnapshot: timingSummary(
          result.table.positionWindowRefreshQueuedSnapshot,
        ),
        positionWindowRefreshSnapshot: timingSummary(
          result.table.positionWindowRefreshSnapshot,
        ),
        positionInsert: timingSummary(result.table.positionInsert),
        positionInsertSnapshot: timingSummary(result.table.positionInsertSnapshot),
        positionRemove: timingSummary(result.table.positionRemove),
        positionRemoveSnapshot: timingSummary(result.table.positionRemoveSnapshot),
        positionRangeRemove: timingSummary(result.table.positionRangeRemove),
        positionRangeRemoveSnapshot: timingSummary(result.table.positionRangeRemoveSnapshot),
        positionReplace: timingSummary(result.table.positionReplace),
        positionReplaceSnapshot: timingSummary(result.table.positionReplaceSnapshot),
        reverse: timingSummary(result.table.reverse),
        reversePipeline: timingSummary(result.table.reversePipeline),
        reversePipelineSnapshot: timingSummary(result.table.reversePipelineSnapshot),
        reverseQueued: timingSummary(result.table.reverseQueued),
        reverseQueuedSnapshot: timingSummary(result.table.reverseQueuedSnapshot),
        reverseSnapshot: timingSummary(result.table.reverseSnapshot),
        sort: timingSummary(result.table.sort),
        sortSnapshot: timingSummary(result.table.sortSnapshot),
        remove: timingSummary(result.table.remove),
        removeSnapshot: timingSummary(result.table.removeSnapshot),
        replace: timingSummary(result.table.replace),
        mappedRollingWindow: timingSummary(result.table.mappedRollingWindow),
        mappedRollingWindowChain: timingSummary(result.table.mappedRollingWindowChain),
        mappedRollingWindowChainSnapshot: timingSummary(
          result.table.mappedRollingWindowChainSnapshot,
        ),
        mappedRollingWindowSnapshot: timingSummary(result.table.mappedRollingWindowSnapshot),
        rollingWindow: timingSummary(result.table.rollingWindow),
        rollingWindowQueued: timingSummary(result.table.rollingWindowQueued),
        rollingWindowQueuedSnapshot: timingSummary(result.table.rollingWindowQueuedSnapshot),
        rollingWindowSnapshot: timingSummary(result.table.rollingWindowSnapshot),
        select: timingSummary(result.table.select),
        snapshotMapLookup: timingSummary(result.table.snapshotMapLookup),
        snapshotMembership: timingSummary(result.table.snapshotMembership),
        slicePrefix: timingSummary(result.table.slicePrefix),
        slicePrefixSnapshot: timingSummary(result.table.slicePrefixSnapshot),
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

async function measureIsolatedTrial(trial, compilerMode, port) {
  const browser = await chromium.launch({
    headless: true,
    ...(browserExecutablePath ? { executablePath: browserExecutablePath } : {}),
  });
  const browserVersion = browser.version();
  try {
    return {
      browserVersion,
      result: await measureTrial(browser, trial, compilerMode, port),
    };
  } finally {
    await browser.close();
  }
}

const isolatedTrials = [
  await measureIsolatedTrial("baseline-a", "off", basePort),
  await measureIsolatedTrial("static", "static", basePort + 1),
  await measureIsolatedTrial("hybrid", "hybrid", basePort + 2),
  await measureIsolatedTrial("baseline-b", "off", basePort + 3),
];
const browserVersion = isolatedTrials[0].browserVersion;
assert(isolatedTrials.every((trial) => trial.browserVersion === browserVersion));
const trials = isolatedTrials.map((trial) => trial.result);

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
  "appendSnapshot",
  "prepend",
  "prependSnapshot",
  "positionBatchInsert",
  "positionBatchInsertSnapshot",
  "positionWindowReplace",
  "positionWindowReplaceQueued",
  "positionWindowReplaceQueuedSnapshot",
  "positionWindowReplaceSnapshot",
  "positionWindowReuse",
  "positionWindowReuseSnapshot",
  "positionWindowResizeReuse",
  "positionWindowResizeReuseSnapshot",
  "positionWindowResizeQueued",
  "positionWindowResizeQueuedSnapshot",
  "positionWindowRefresh",
  "positionWindowRefreshQueued",
  "positionWindowRefreshQueuedSnapshot",
  "positionWindowRefreshSnapshot",
  "positionInsert",
  "positionInsertSnapshot",
  "positionRemove",
  "positionRemoveSnapshot",
  "positionRangeRemove",
  "positionRangeRemoveSnapshot",
  "positionReplace",
  "positionReplaceSnapshot",
  "reverse",
  "reversePipeline",
  "reversePipelineSnapshot",
  "reverseQueued",
  "reverseQueuedSnapshot",
  "reverseSnapshot",
  "sort",
  "sortSnapshot",
  "updateEvery10th",
  "select",
  "membership",
  "mapLookup",
  "denseMembership",
  "denseMapLookup",
  "filterReorderPipeline",
  "filterReorderPipelineSnapshot",
  "filterAppendMapQueued",
  "filterAppendMapQueuedSnapshot",
  "filterMapAppendQueued",
  "filterMapAppendQueuedSnapshot",
  "structuralAppendQueued",
  "structuralAppendQueuedSnapshot",
  "structuralPrependQueued",
  "structuralPrependQueuedSnapshot",
  "structuralPrependMapQueued",
  "structuralPrependMapQueuedSnapshot",
  "structuralAppendMapQueued",
  "structuralAppendMapQueuedSnapshot",
  "mapStructuralReorderPipeline",
  "mapStructuralReorderPipelineSnapshot",
  "mapReorderPipeline",
  "mapReorderPipelineSnapshot",
  "multiMapUpdate",
  "multiMapUpdateSnapshot",
  "multiMapReorderPipeline",
  "multiMapReorderPipelineSnapshot",
  "multiMapReversePipeline",
  "multiMapReversePipelineSnapshot",
  "multiMapReverseParity",
  "multiMapReverseParitySnapshot",
  "queuedMapReverseParity",
  "queuedMapReverseParitySnapshot",
  "reorderThenMapPipeline",
  "reorderThenMapPipelineSnapshot",
  "queuedReorderThenMapPipeline",
  "queuedReorderThenMapPipelineSnapshot",
  "queuedMapThenReorderPipeline",
  "queuedMapThenReorderPipelineSnapshot",
  "queuedMapReorderChain",
  "queuedMapReorderChainSnapshot",
  "snapshotMembership",
  "snapshotMapLookup",
  "slicePrefix",
  "slicePrefixSnapshot",
  "swap",
  "remove",
  "removeSnapshot",
  "mappedRollingWindow",
  "mappedRollingWindowChain",
  "mappedRollingWindowChainSnapshot",
  "mappedRollingWindowSnapshot",
  "rollingWindow",
  "rollingWindowQueued",
  "rollingWindowQueuedSnapshot",
  "rollingWindowSnapshot",
  "clear",
];
const scaleMetrics = [
  "create10k",
  "appendTo20k",
  "prependAt20k",
  "updateEvery10th20k",
  "select20k",
  "membership20k",
  "mapLookup20k",
  "denseMembership20k",
  "denseMapLookup20k",
  "snapshotMembership20k",
  "snapshotMapLookup20k",
  "slicePrefixAt21k",
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
  ["prependAt20k", "prepend", 2],
  ["slicePrefixAt21k", "slicePrefix", 2],
  ["updateEvery10th20k", "updateEvery10th", 2],
  ["select20k", "select", 20],
  ["membership20k", "membership", 20],
  ["mapLookup20k", "mapLookup", 20],
  ["denseMembership20k", "denseMembership", 20],
  ["denseMapLookup20k", "denseMapLookup", 20],
  ["snapshotMembership20k", "snapshotMembership", 20],
  ["snapshotMapLookup20k", "snapshotMapLookup", 20],
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
// The general regression gate above only proves that compiled output is not slower than React.
// Keep a separate floor for the mutation-aware keyed update this benchmark is designed to protect:
// without the hint, the older compiled reconciliation path is still faster than React and would
// otherwise pass despite losing most of the optimization.
const keyedUpdateMinimumSpeedup = 8;
const keyedUpdateCases = [
  ["table", "updateEvery10th"],
  ["scale", "updateEvery10th20k"],
];
const keyedUpdateSpeedups = keyedUpdateCases.flatMap(([group, metric]) =>
  ["static", "hybrid"].map((mode) => ({
    group,
    metric,
    mode,
    speedup: comparisons[group][metric][`${mode}VsBaseline`].speedup,
  })),
);
const keyedUpdateRegressions = keyedUpdateSpeedups.filter(
  ({ speedup }) => !Number.isFinite(speedup) || speedup < keyedUpdateMinimumSpeedup,
);
// Consecutive safe map stages should compare their committed and final item identities once, then
// patch each final changed row once. Compare the concise chain with React and a block-bodied
// compiled control that deliberately takes complete keyed reconciliation.
const keyedMultiMapUpdateMinimumSpeedup = 8;
const keyedMultiMapUpdateMinimumSnapshotSpeedup = 2;
const keyedMultiMapUpdateResults = ["static", "hybrid"].map((mode) => {
  const updateMedianMs = comparisons.table.multiMapUpdate[mode].medianMs;
  const snapshotMedianMs = comparisons.table.multiMapUpdateSnapshot[mode].medianMs;
  return {
    mode,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / updateMedianMs,
    speedup: comparisons.table.multiMapUpdate[`${mode}VsBaseline`].speedup,
    updateMedianMs,
  };
});
const keyedMultiMapUpdateRegressions = keyedMultiMapUpdateResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMultiMapUpdateMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMultiMapUpdateMinimumSnapshotSpeedup,
);
// A compiler-proven functional append already creates the new array and DOM rows. The append hint
// avoids rescanning every existing key and binding before mounting only the appended suffix. Compare
// it with both React and an equivalent block-bodied compiled updater that intentionally stays on
// complete keyed reconciliation.
const keyedAppendMinimumSpeedup = 4;
const keyedAppendMinimumSnapshotSpeedup = 1.25;
const keyedAppendResults = ["static", "hybrid"].map((mode) => {
  const appendMedianMs = comparisons.table.append[mode].medianMs;
  const snapshotMedianMs = comparisons.table.appendSnapshot[mode].medianMs;
  return {
    appendMedianMs,
    mode,
    scaleSpeedup: comparisons.scale.appendTo20k[`${mode}VsBaseline`].speedup,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / appendMedianMs,
    speedup: comparisons.table.append[`${mode}VsBaseline`].speedup,
  };
});
const keyedAppendRegressions = keyedAppendResults.filter(
  ({ scaleSpeedup, snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedAppendMinimumSpeedup ||
    !Number.isFinite(scaleSpeedup) ||
    scaleSpeedup < keyedAppendMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedAppendMinimumSnapshotSpeedup,
);
// A compiler-proven prepend creates only the new prefix while preserving the existing keyed DOM
// suffix. Compare it with React and an equivalent block-bodied compiled snapshot path, and keep a
// separate 20,000-row floor so the optimization cannot silently collapse into a full row refresh.
const keyedPrependMinimumSpeedup = 3;
const keyedPrependMinimumSnapshotSpeedup = 1.25;
const keyedPrependResults = ["static", "hybrid"].map((mode) => {
  const prependMedianMs = comparisons.table.prepend[mode].medianMs;
  const snapshotMedianMs = comparisons.table.prependSnapshot[mode].medianMs;
  return {
    mode,
    prependMedianMs,
    scaleSpeedup: comparisons.scale.prependAt20k[`${mode}VsBaseline`].speedup,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / prependMedianMs,
    speedup: comparisons.table.prepend[`${mode}VsBaseline`].speedup,
  };
});
const keyedPrependRegressions = keyedPrependResults.filter(
  ({ scaleSpeedup, snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedPrependMinimumSpeedup ||
    !Number.isFinite(scaleSpeedup) ||
    scaleSpeedup < keyedPrependMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedPrependMinimumSnapshotSpeedup,
);
// A compiler-proven native slice with an event-local runtime bound identifies one exact retained
// interval after runtime validation. Reuse those row instances without rescanning their keys,
// descriptors, or bindings. Compare it with React and a block-bodied compiled control, and
// preserve the same advantage after trimming a 21,000-row list.
const keyedSliceMinimumSpeedup = 3;
const keyedSliceMinimumSnapshotSpeedup = 1.25;
const keyedSliceResults = ["static", "hybrid"].map((mode) => {
  const sliceMedianMs = comparisons.table.slicePrefix[mode].medianMs;
  const snapshotMedianMs = comparisons.table.slicePrefixSnapshot[mode].medianMs;
  return {
    mode,
    scaleSpeedup: comparisons.scale.slicePrefixAt21k[`${mode}VsBaseline`].speedup,
    sliceMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / sliceMedianMs,
    speedup: comparisons.table.slicePrefix[`${mode}VsBaseline`].speedup,
  };
});
const keyedSliceRegressions = keyedSliceResults.filter(
  ({ scaleSpeedup, snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedSliceMinimumSpeedup ||
    !Number.isFinite(scaleSpeedup) ||
    scaleSpeedup < keyedSliceMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedSliceMinimumSnapshotSpeedup,
);
// A rolling window combines one proven boundary removal with one incoming suffix. It should keep
// the retained DOM rows untouched and stay materially ahead of both React and an equivalent
// block-bodied compiled control at 10,000 rows.
const keyedRollingWindowMinimumSpeedup = 2;
const keyedRollingWindowMinimumSnapshotSpeedup = 1.25;
const keyedRollingWindowResults = ["static", "hybrid"].map((mode) => {
  const rollingMedianMs = comparisons.table.rollingWindow[mode].medianMs;
  const snapshotMedianMs = comparisons.table.rollingWindowSnapshot[mode].medianMs;
  return {
    mode,
    rollingMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / rollingMedianMs,
    speedup: comparisons.table.rollingWindow[`${mode}VsBaseline`].speedup,
  };
});
const keyedRollingWindowRegressions = keyedRollingWindowResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedRollingWindowMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedRollingWindowMinimumSnapshotSpeedup,
);
// A mapped rolling window should retain the same committed-row proof across safe maps on either
// side of the boundary change. Protect both the React-relative win and the improvement over an
// equivalent compiled control whose block-bodied rolling setter must reconcile the full list.
const keyedMappedRollingWindowMinimumSpeedup = 2;
const keyedMappedRollingWindowMinimumSnapshotSpeedup = 1.25;
const keyedMappedRollingWindowResults = ["static", "hybrid"].map((mode) => {
  const rollingMedianMs = comparisons.table.mappedRollingWindow[mode].medianMs;
  const snapshotMedianMs = comparisons.table.mappedRollingWindowSnapshot[mode].medianMs;
  return {
    mode,
    rollingMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / rollingMedianMs,
    speedup: comparisons.table.mappedRollingWindow[`${mode}VsBaseline`].speedup,
  };
});
const keyedMappedRollingWindowRegressions = keyedMappedRollingWindowResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMappedRollingWindowMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMappedRollingWindowMinimumSnapshotSpeedup,
);
// Safe maps surrounding multiple queued rolling setters should retain one committed-row proof
// through the complete chain. Protect the dedicated chain path against React and an equivalent
// block-bodied control while leaving the existing single-window and plain queued gates intact.
const keyedMappedRollingWindowChainMinimumSpeedup = 2;
const keyedMappedRollingWindowChainMinimumSnapshotSpeedup = 1.25;
const keyedMappedRollingWindowChainResults = ["static", "hybrid"].map((mode) => {
  const rollingMedianMs = comparisons.table.mappedRollingWindowChain[mode].medianMs;
  const snapshotMedianMs = comparisons.table.mappedRollingWindowChainSnapshot[mode].medianMs;
  return {
    mode,
    rollingMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / rollingMedianMs,
    speedup: comparisons.table.mappedRollingWindowChain[`${mode}VsBaseline`].speedup,
  };
});
const keyedMappedRollingWindowChainRegressions = keyedMappedRollingWindowChainResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMappedRollingWindowChainMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMappedRollingWindowChainMinimumSnapshotSpeedup,
);
// Two queued rolling setters should collapse to the final retained committed suffix and incoming
// rows. Keep the queued 10,000-row workload ahead of both React and an equivalent block-bodied
// compiled control so an intermediate uncommitted array cannot silently restore the full scan.
const keyedQueuedRollingWindowMinimumSpeedup = 2;
const keyedQueuedRollingWindowMinimumSnapshotSpeedup = 1.25;
const keyedQueuedRollingWindowResults = ["static", "hybrid"].map((mode) => {
  const rollingMedianMs = comparisons.table.rollingWindowQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.rollingWindowQueuedSnapshot[mode].medianMs;
  return {
    mode,
    rollingMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / rollingMedianMs,
    speedup: comparisons.table.rollingWindowQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedRollingWindowRegressions = keyedQueuedRollingWindowResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedRollingWindowMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedRollingWindowMinimumSnapshotSpeedup,
);
// A compiler-proven toSpliced(position, 0, ...items) insertion creates the incoming rows in one
// fragment and leaves both retained sides untouched. Protect that exact 10,000-row/64-row workload
// against React and the equivalent block-bodied compiled control without changing older gates.
const keyedBatchInsertMinimumSpeedup = 4;
const keyedBatchInsertMinimumSnapshotSpeedup = 1.5;
const keyedBatchInsertResults = ["static", "hybrid"].map((mode) => {
  const batchMedianMs = comparisons.table.positionBatchInsert[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionBatchInsertSnapshot[mode].medianMs;
  return {
    batchMedianMs,
    mode,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / batchMedianMs,
    speedup: comparisons.table.positionBatchInsert[`${mode}VsBaseline`].speedup,
  };
});
const keyedBatchInsertRegressions = keyedBatchInsertResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedBatchInsertMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedBatchInsertMinimumSnapshotSpeedup,
);
// A compiler-proven toSpliced(position, runtimeCount, ...items) replacement can validate the
// evaluated count, retained prefix and suffix, prepare the incoming rows, and swap only that exact
// DOM window. Keep this 10,000-row/64-row workload independent from the literal-count, insertion,
// and single-position gates.
const keyedWindowReplaceMinimumSpeedup = 4;
const keyedWindowReplaceMinimumSnapshotSpeedup = 1.5;
const keyedWindowReplaceResults = ["static", "hybrid"].map((mode) => {
  const windowMedianMs = comparisons.table.positionWindowReplace[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionWindowReplaceSnapshot[mode].medianMs;
  return {
    mode,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / windowMedianMs,
    speedup: comparisons.table.positionWindowReplace[`${mode}VsBaseline`].speedup,
    windowMedianMs,
  };
});
const keyedWindowReplaceRegressions = keyedWindowReplaceResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedWindowReplaceMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedWindowReplaceMinimumSnapshotSpeedup,
);
// A fixed-length exact window may mix keys reused from that same removed window with globally
// fresh keys. Protect local identity retention, local LIS moves, and bounded row preparation
// independently from both all-fresh replacement and same-key refresh.
const keyedWindowReuseMinimumSpeedup = 4;
const keyedWindowReuseMinimumSnapshotSpeedup = 1.5;
const keyedWindowReuseResults = ["static", "hybrid"].map((mode) => {
  const reuseMedianMs = comparisons.table.positionWindowReuse[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionWindowReuseSnapshot[mode].medianMs;
  return {
    mode,
    reuseMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / reuseMedianMs,
    speedup: comparisons.table.positionWindowReuse[`${mode}VsBaseline`].speedup,
  };
});
const keyedWindowReuseRegressions = keyedWindowReuseResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedWindowReuseMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedWindowReuseMinimumSnapshotSpeedup,
);
// A variable-length exact window can retain and reorder keys from its own removed interval while
// adding fresh rows and shifting the untouched suffix. Keep this separate from fixed-length reuse
// so a fallback to complete list reconciliation cannot hide behind the existing gate.
const keyedWindowResizeReuseMinimumSpeedup = 4;
const keyedWindowResizeReuseMinimumSnapshotSpeedup = 1.5;
const keyedWindowResizeReuseResults = ["static", "hybrid"].map((mode) => {
  const reuseMedianMs = comparisons.table.positionWindowResizeReuse[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionWindowResizeReuseSnapshot[mode].medianMs;
  return {
    mode,
    reuseMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / reuseMedianMs,
    speedup: comparisons.table.positionWindowResizeReuse[`${mode}VsBaseline`].speedup,
  };
});
const keyedWindowResizeReuseRegressions = keyedWindowResizeReuseResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedWindowResizeReuseMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedWindowResizeReuseMinimumSnapshotSpeedup,
);
// Two disjoint grow/shrink windows queued before one flush must normalize their source and final
// coordinates, preserve local key identity, and commit atomically. Keep this separate from the
// single resized-window gate so a structural-chain fallback cannot hide behind that result.
const keyedQueuedWindowResizeMinimumSpeedup = 4;
const keyedQueuedWindowResizeMinimumSnapshotSpeedup = 1.5;
const keyedQueuedWindowResizeResults = ["static", "hybrid"].map((mode) => {
  const resizeMedianMs = comparisons.table.positionWindowResizeQueued[mode].medianMs;
  const snapshotMedianMs =
    comparisons.table.positionWindowResizeQueuedSnapshot[mode].medianMs;
  return {
    mode,
    resizeMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / resizeMedianMs,
    speedup: comparisons.table.positionWindowResizeQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedWindowResizeRegressions = keyedQueuedWindowResizeResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedWindowResizeMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedWindowResizeMinimumSnapshotSpeedup,
);
// A same-key exact window should retain every row and patch only the changed bindings. Keep this
// gate separate from fresh-key replacement so descriptor/DOM work cannot hide a refresh regression.
const keyedWindowRefreshMinimumSpeedup = 4;
const keyedWindowRefreshMinimumSnapshotSpeedup = 1.5;
const keyedWindowRefreshResults = ["static", "hybrid"].map((mode) => {
  const refreshMedianMs = comparisons.table.positionWindowRefresh[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionWindowRefreshSnapshot[mode].medianMs;
  return {
    mode,
    refreshMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / refreshMedianMs,
    speedup: comparisons.table.positionWindowRefresh[`${mode}VsBaseline`].speedup,
  };
});
const keyedWindowRefreshRegressions = keyedWindowRefreshResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedWindowRefreshMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedWindowRefreshMinimumSnapshotSpeedup,
);
// Two length-preserving same-key windows queued before one flush should compose into one atomic
// targeted refresh. Protect this batched path independently so it cannot regress to complete list
// reconciliation while the existing single-window gate continues to pass.
const keyedQueuedWindowRefreshMinimumSpeedup = 4;
const keyedQueuedWindowRefreshMinimumSnapshotSpeedup = 1.5;
const keyedQueuedWindowRefreshResults = ["static", "hybrid"].map((mode) => {
  const refreshMedianMs = comparisons.table.positionWindowRefreshQueued[mode].medianMs;
  const snapshotMedianMs =
    comparisons.table.positionWindowRefreshQueuedSnapshot[mode].medianMs;
  return {
    mode,
    refreshMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / refreshMedianMs,
    speedup: comparisons.table.positionWindowRefreshQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedWindowRefreshRegressions = keyedQueuedWindowRefreshResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedWindowRefreshMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedWindowRefreshMinimumSnapshotSpeedup,
);
// Two overlapping fixed-length fresh-key windows should create and swap only the final union.
// Protect the queued replacement path separately from both the single-window replacement and the
// queued same-key refresh so neither can hide a regression to complete reconciliation.
const keyedQueuedWindowReplaceMinimumSpeedup = 4;
const keyedQueuedWindowReplaceMinimumSnapshotSpeedup = 1.5;
const keyedQueuedWindowReplaceResults = ["static", "hybrid"].map((mode) => {
  const replaceMedianMs = comparisons.table.positionWindowReplaceQueued[mode].medianMs;
  const snapshotMedianMs =
    comparisons.table.positionWindowReplaceQueuedSnapshot[mode].medianMs;
  return {
    mode,
    replaceMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / replaceMedianMs,
    speedup: comparisons.table.positionWindowReplaceQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedWindowReplaceRegressions = keyedQueuedWindowReplaceResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedWindowReplaceMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedWindowReplaceMinimumSnapshotSpeedup,
);
// Native toSpliced()/with() calls with event-local runtime positions expose one exact insertion,
// removal, or replacement position. The hinted runtime should beat both React and an equivalent
// block-bodied compiled control while preserving the same row identities around the changed position.
const keyedPositionInsertMinimumSpeedup = 1.1;
const keyedPositionInsertMinimumSnapshotSpeedup = 1.1;
const keyedPositionRemoveMinimumSpeedup = 4;
const keyedPositionRemoveMinimumSnapshotSpeedup = 1.5;
const keyedPositionReplaceMinimumSpeedup = 2;
const keyedPositionReplaceMinimumSnapshotSpeedup = 1.5;
const keyedPositionResults = ["static", "hybrid"].map((mode) => {
  const insertMedianMs = comparisons.table.positionInsert[mode].medianMs;
  const insertSnapshotMedianMs = comparisons.table.positionInsertSnapshot[mode].medianMs;
  const removeMedianMs = comparisons.table.positionRemove[mode].medianMs;
  const removeSnapshotMedianMs = comparisons.table.positionRemoveSnapshot[mode].medianMs;
  const replaceMedianMs = comparisons.table.positionReplace[mode].medianMs;
  const replaceSnapshotMedianMs = comparisons.table.positionReplaceSnapshot[mode].medianMs;
  return {
    insertMedianMs,
    insertSnapshotMedianMs,
    insertSnapshotSpeedup: insertSnapshotMedianMs / insertMedianMs,
    insertSpeedup: comparisons.table.positionInsert[`${mode}VsBaseline`].speedup,
    mode,
    removeMedianMs,
    removeSnapshotMedianMs,
    removeSnapshotSpeedup: removeSnapshotMedianMs / removeMedianMs,
    removeSpeedup: comparisons.table.positionRemove[`${mode}VsBaseline`].speedup,
    replaceMedianMs,
    replaceSnapshotMedianMs,
    replaceSnapshotSpeedup: replaceSnapshotMedianMs / replaceMedianMs,
    replaceSpeedup: comparisons.table.positionReplace[`${mode}VsBaseline`].speedup,
  };
});
const keyedPositionRegressions = keyedPositionResults.filter(
  ({
    insertSnapshotSpeedup,
    insertSpeedup,
    removeSnapshotSpeedup,
    removeSpeedup,
    replaceSnapshotSpeedup,
    replaceSpeedup,
  }) =>
    !Number.isFinite(insertSpeedup) ||
    insertSpeedup < keyedPositionInsertMinimumSpeedup ||
    !Number.isFinite(insertSnapshotSpeedup) ||
    insertSnapshotSpeedup < keyedPositionInsertMinimumSnapshotSpeedup ||
    !Number.isFinite(removeSpeedup) ||
    removeSpeedup < keyedPositionRemoveMinimumSpeedup ||
    !Number.isFinite(removeSnapshotSpeedup) ||
    removeSnapshotSpeedup < keyedPositionRemoveMinimumSnapshotSpeedup ||
    !Number.isFinite(replaceSpeedup) ||
    replaceSpeedup < keyedPositionReplaceMinimumSpeedup ||
    !Number.isFinite(replaceSnapshotSpeedup) ||
    replaceSnapshotSpeedup < keyedPositionReplaceMinimumSnapshotSpeedup,
);
// A fixed positive toSpliced() delete count exposes one exact contiguous removal range. The hinted
// runtime should remove only that range while retaining the surrounding DOM nodes, and it should
// stay ahead of React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedRangeRemovalMinimumSpeedup = 4;
const keyedRangeRemovalMinimumSnapshotSpeedup = 1.5;
const keyedRangeRemovalResults = ["static", "hybrid"].map((mode) => {
  const rangeMedianMs = comparisons.table.positionRangeRemove[mode].medianMs;
  const snapshotMedianMs = comparisons.table.positionRangeRemoveSnapshot[mode].medianMs;
  return {
    mode,
    rangeMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / rangeMedianMs,
    speedup: comparisons.table.positionRangeRemove[`${mode}VsBaseline`].speedup,
  };
});
const keyedRangeRemovalRegressions = keyedRangeRemovalResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedRangeRemovalMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedRangeRemovalMinimumSnapshotSpeedup,
);
// A direct native reverse exposes the complete permutation. The hinted path should preserve the
// same keyed DOM nodes while avoiding key, descriptor, binding, and generic LIS work. Compare it
// with both React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedReorderMinimumSpeedup = 8;
const keyedReorderMinimumSnapshotSpeedup = 1.25;
const keyedReorderResults = ["static", "hybrid"].map((mode) => {
  const reverseMedianMs = comparisons.table.reverse[mode].medianMs;
  const snapshotMedianMs = comparisons.table.reverseSnapshot[mode].medianMs;
  return {
    mode,
    reverseMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / reverseMedianMs,
    speedup: comparisons.table.reverse[`${mode}VsBaseline`].speedup,
  };
});
const keyedReorderRegressions = keyedReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedReorderMinimumSnapshotSpeedup,
);
// Two native reversals queued before one commit end in the original order. The composed hint
// should validate that final permutation once, preserve every DOM node without moving it, and
// stay ahead of React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedQueuedReorderMinimumSpeedup = 2;
const keyedQueuedReorderMinimumSnapshotSpeedup = 1.25;
const keyedQueuedReorderResults = ["static", "hybrid"].map((mode) => {
  const reverseMedianMs = comparisons.table.reverseQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.reverseQueuedSnapshot[mode].medianMs;
  return {
    mode,
    reverseMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / reverseMedianMs,
    speedup: comparisons.table.reverseQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedReorderRegressions = keyedQueuedReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedReorderMinimumSnapshotSpeedup,
);
// Two native reversals inside one functional setter also end in the original order. The compiler
// should preserve the full pipeline metadata, validate its final permutation once, and stay ahead
// of React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedReorderPipelineMinimumSpeedup = 2;
const keyedReorderPipelineMinimumSnapshotSpeedup = 1.25;
const keyedReorderPipelineResults = ["static", "hybrid"].map((mode) => {
  const reverseMedianMs = comparisons.table.reversePipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.reversePipelineSnapshot[mode].medianMs;
  return {
    mode,
    reverseMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / reverseMedianMs,
    speedup: comparisons.table.reversePipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedReorderPipelineRegressions = keyedReorderPipelineResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedReorderPipelineMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedReorderPipelineMinimumSnapshotSpeedup,
);
// Filtering followed by native reorder steps changes membership and order in one setter. The
// hinted path must preserve every surviving row, remove rejected rows, and stay ahead of React and
// the equivalent block-bodied compiled control at 10,000 rows.
const keyedStructuralReorderMinimumSpeedup = 2;
const keyedStructuralReorderMinimumSnapshotSpeedup = 1.25;
const keyedStructuralReorderResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.filterReorderPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.filterReorderPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.filterReorderPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedStructuralReorderRegressions = keyedStructuralReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedStructuralReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedStructuralReorderMinimumSnapshotSpeedup,
);
// A filter or bounded slice followed by an adjacent immutable append keeps the same committed
// source. The hinted path should remove only rejected rows, create only the final suffix, and stay
// ahead of React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedStructuralAppendMinimumSpeedup = 2;
const keyedStructuralAppendMinimumSnapshotSpeedup = 1.25;
const keyedStructuralAppendResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.structuralAppendQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.structuralAppendQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.structuralAppendQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedStructuralAppendRegressions = keyedStructuralAppendResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedStructuralAppendMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedStructuralAppendMinimumSnapshotSpeedup,
);
// A bounded slice followed by an adjacent immutable prepend keeps an exact committed survivor
// interval. The hinted path should remove only rejected rows, create only the new prefix, and stay
// ahead of React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedStructuralPrependMinimumSpeedup = 2;
const keyedStructuralPrependMinimumSnapshotSpeedup = 1.25;
const keyedStructuralPrependResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.structuralPrependQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.structuralPrependQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.structuralPrependQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedStructuralPrependRegressions = keyedStructuralPrependResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedStructuralPrependMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedStructuralPrependMinimumSnapshotSpeedup,
);
// A following same-key map can retain a bounded slice's survivor and prefix proof. The hinted path
// should patch only changed survivors, create only the final prefix, and stay ahead of both React
// and the equivalent block-bodied compiled control at 10,000 rows.
const keyedStructuralPrependMapMinimumSpeedup = 2;
const keyedStructuralPrependMapMinimumSnapshotSpeedup = 1.25;
const keyedStructuralPrependMapResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.structuralPrependMapQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.structuralPrependMapQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.structuralPrependMapQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedStructuralPrependMapRegressions = keyedStructuralPrependMapResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedStructuralPrependMapMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedStructuralPrependMapMinimumSnapshotSpeedup,
);
// A following same-key map can keep a bounded slice's stable-key and suffix proof. The hinted path
// should patch only changed survivors while retaining the structural append speedup over React and
// the equivalent block-bodied compiled control.
const keyedStructuralAppendMapMinimumSpeedup = 2;
const keyedStructuralAppendMapMinimumSnapshotSpeedup = 1.25;
const keyedStructuralAppendMapResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.structuralAppendMapQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.structuralAppendMapQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.structuralAppendMapQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedStructuralAppendMapRegressions = keyedStructuralAppendMapResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedStructuralAppendMapMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedStructuralAppendMapMinimumSnapshotSpeedup,
);
// A safe filter can retain its original survivor positions through adjacent append and map setters.
// Keep this distinct from the bounded-slice gate so both structural lineage variants remain covered.
const keyedFilterAppendMapMinimumSpeedup = 2;
const keyedFilterAppendMapMinimumSnapshotSpeedup = 1.25;
const keyedFilterAppendMapResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.filterAppendMapQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.filterAppendMapQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.filterAppendMapQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedFilterAppendMapRegressions = keyedFilterAppendMapResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedFilterAppendMapMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedFilterAppendMapMinimumSnapshotSpeedup,
);
// A safe map between a filter and a later append should retain the same committed survivor proof.
// This gate prevents the new call order from silently returning to complete keyed reconciliation.
const keyedFilterMapAppendMinimumSpeedup = 2;
const keyedFilterMapAppendMinimumSnapshotSpeedup = 1.25;
const keyedFilterMapAppendResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.filterMapAppendQueued[mode].medianMs;
  const snapshotMedianMs = comparisons.table.filterMapAppendQueuedSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.filterMapAppendQueued[`${mode}VsBaseline`].speedup,
  };
});
const keyedFilterMapAppendRegressions = keyedFilterMapAppendResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedFilterMapAppendMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedFilterMapAppendMinimumSnapshotSpeedup,
);
// A safe filter, terminal map, and two native reverses in adjacent setters change membership and
// row data while restoring the survivor order in one queued commit. The combined path must remove
// the rejected row, patch the changed survivor, and retain structural lineage through both reorder
// boundaries instead of dropping to complete keyed reconciliation.
const keyedMappedStructuralReorderMinimumSpeedup = 2;
const keyedMappedStructuralReorderMinimumSnapshotSpeedup = 1.25;
const keyedMappedStructuralReorderResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.mapStructuralReorderPipeline[mode].medianMs;
  const snapshotMedianMs =
    comparisons.table.mapStructuralReorderPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.mapStructuralReorderPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedMappedStructuralReorderRegressions = keyedMappedStructuralReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMappedStructuralReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMappedStructuralReorderMinimumSnapshotSpeedup,
);
// Editing one same-key row and immediately sorting it should reuse all keyed DOM rows, patch only
// the changed bindings, and run one LIS against the final order. Compare the concise hinted setter
// with React and the equivalent block-bodied compiled control at 10,000 rows.
const keyedMapReorderMinimumSpeedup = 4;
const keyedMapReorderMinimumSnapshotSpeedup = 1.2;
const keyedMapReorderResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.mapReorderPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.mapReorderPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.mapReorderPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedMapReorderRegressions = keyedMapReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMapReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMapReorderMinimumSnapshotSpeedup,
);
// Multiple safe map stages should keep one flat source-row lineage and still reconcile only the
// final permutation. Compare the concise two-map setter with React and its block-bodied compiled
// control at 10,000 rows.
const keyedMultiMapReorderMinimumSpeedup = 4;
const keyedMultiMapReorderMinimumSnapshotSpeedup = 1.2;
const keyedMultiMapReorderResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.multiMapReorderPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.multiMapReorderPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.multiMapReorderPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedMultiMapReorderRegressions = keyedMultiMapReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMultiMapReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMultiMapReorderMinimumSnapshotSpeedup,
);
// A compiler-proven map chain followed directly by toReversed() has an exact permutation. It
// should use the minimum-move reverse path instead of allocating an item map and running LIS.
const keyedMultiMapReverseMinimumSpeedup = 4;
const keyedMultiMapReverseMinimumSnapshotSpeedup = 1.2;
const keyedMultiMapReverseResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.multiMapReversePipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.multiMapReversePipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.multiMapReversePipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedMultiMapReverseRegressions = keyedMultiMapReverseResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMultiMapReverseMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMultiMapReverseMinimumSnapshotSpeedup,
);
// Two reversals after a compiler-proven map chain return every row to committed order. The exact
// parity path should patch changed bindings without allocating the generic source map, running LIS,
// or moving DOM rows. Compare it with React and the equivalent complete-reconciliation control.
const keyedMappedReverseParityMinimumSpeedup = 8;
const keyedMappedReverseParityMinimumSnapshotSpeedup = 1.5;
const keyedMappedReverseParityResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.multiMapReverseParity[mode].medianMs;
  const snapshotMedianMs = comparisons.table.multiMapReverseParitySnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.multiMapReverseParity[`${mode}VsBaseline`].speedup,
  };
});
const keyedMappedReverseParityRegressions = keyedMappedReverseParityResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMappedReverseParityMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedMappedReverseParityMinimumSnapshotSpeedup,
);
// Separate queued setters can reverse the committed rows, update through safe maps, and reverse
// again. The final order is still exact identity, so it should retain the same bounded row patch
// without generic source-map, LIS, or DOM-movement work.
const keyedQueuedMapReverseParityMinimumSpeedup = 8;
const keyedQueuedMapReverseParityMinimumSnapshotSpeedup = 1.5;
const keyedQueuedMapReverseParityResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.queuedMapReverseParity[mode].medianMs;
  const snapshotMedianMs = comparisons.table.queuedMapReverseParitySnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.queuedMapReverseParity[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedMapReverseParityRegressions = keyedQueuedMapReverseParityResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedMapReverseParityMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedMapReverseParityMinimumSnapshotSpeedup,
);
// A safe map suffix must retain the preceding native reorder. The exact reverse path should move
// the minimum rows, patch only changed bindings, and avoid the generic source-item lookup and LIS.
const keyedReorderThenMapMinimumSpeedup = 4;
const keyedReorderThenMapMinimumSnapshotSpeedup = 1.2;
const keyedReorderThenMapResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.reorderThenMapPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.reorderThenMapPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.reorderThenMapPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedReorderThenMapRegressions = keyedReorderThenMapResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedReorderThenMapMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedReorderThenMapMinimumSnapshotSpeedup,
);
// Separate adjacent setters should retain the reorder proof through each safe same-order map.
// Compare the concise queued sequence with React and block-bodied complete reconciliation.
const keyedQueuedReorderThenMapMinimumSpeedup = 4;
const keyedQueuedReorderThenMapMinimumSnapshotSpeedup = 1.2;
const keyedQueuedReorderThenMapResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.queuedReorderThenMapPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.queuedReorderThenMapPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.queuedReorderThenMapPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedReorderThenMapRegressions = keyedQueuedReorderThenMapResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedReorderThenMapMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedReorderThenMapMinimumSnapshotSpeedup,
);
// The mirror queued sequence must retain safe map lineage into a following native reorder.
// Compare three concise setters with React and block-bodied complete reconciliation.
const keyedQueuedMapThenReorderMinimumSpeedup = 4;
const keyedQueuedMapThenReorderMinimumSnapshotSpeedup = 1.2;
const keyedQueuedMapThenReorderResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.queuedMapThenReorderPipeline[mode].medianMs;
  const snapshotMedianMs = comparisons.table.queuedMapThenReorderPipelineSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.queuedMapThenReorderPipeline[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedMapThenReorderRegressions = keyedQueuedMapThenReorderResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedMapThenReorderMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedMapThenReorderMinimumSnapshotSpeedup,
);
// Mapped lineage should survive every adjacent native reorder setter, not only the first one.
// Compare maps plus two concise reversals with React and block-bodied complete reconciliation.
const keyedQueuedMapReorderChainMinimumSpeedup = 4;
const keyedQueuedMapReorderChainMinimumSnapshotSpeedup = 1.2;
const keyedQueuedMapReorderChainResults = ["static", "hybrid"].map((mode) => {
  const pipelineMedianMs = comparisons.table.queuedMapReorderChain[mode].medianMs;
  const snapshotMedianMs = comparisons.table.queuedMapReorderChainSnapshot[mode].medianMs;
  return {
    mode,
    pipelineMedianMs,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / pipelineMedianMs,
    speedup: comparisons.table.queuedMapReorderChain[`${mode}VsBaseline`].speedup,
  };
});
const keyedQueuedMapReorderChainRegressions = keyedQueuedMapReorderChainResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedQueuedMapReorderChainMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedQueuedMapReorderChainMinimumSnapshotSpeedup,
);
// A direct native toSorted() exposes a permutation while preserving every keyed row object. The
// hinted path validates that permutation by item identity, uses LIS to move only the required DOM
// nodes, and avoids key, descriptor, and binding reads. Compare it with React and the equivalent
// block-bodied compiled control at 10,000 rows.
const keyedSortMinimumSpeedup = 4;
const keyedSortMinimumSnapshotSpeedup = 1.25;
const keyedSortResults = ["static", "hybrid"].map((mode) => {
  const sortMedianMs = comparisons.table.sort[mode].medianMs;
  const snapshotMedianMs = comparisons.table.sortSnapshot[mode].medianMs;
  return {
    mode,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / sortMedianMs,
    sortMedianMs,
    speedup: comparisons.table.sort[`${mode}VsBaseline`].speedup,
  };
});
const keyedSortRegressions = keyedSortResults.filter(
  ({ snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedSortMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedSortMinimumSnapshotSpeedup,
);
// A concise native filter carries removal positions into the keyed-row runtime. Compare it with
// React and an equivalent block-bodied compiled update that intentionally takes complete keyed
// reconciliation, while also preserving the 20,000-row end-to-end speedup.
const keyedFilterMinimumSpeedup = 3;
const keyedFilterMinimumSnapshotSpeedup = 1.25;
const keyedFilterResults = ["static", "hybrid"].map((mode) => {
  const filterMedianMs = comparisons.table.remove[mode].medianMs;
  const snapshotMedianMs = comparisons.table.removeSnapshot[mode].medianMs;
  return {
    filterMedianMs,
    mode,
    scaleSpeedup: comparisons.scale.remove20k[`${mode}VsBaseline`].speedup,
    snapshotMedianMs,
    snapshotSpeedup: snapshotMedianMs / filterMedianMs,
    speedup: comparisons.table.remove[`${mode}VsBaseline`].speedup,
  };
});
const keyedFilterRegressions = keyedFilterResults.filter(
  ({ scaleSpeedup, snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedFilterMinimumSpeedup ||
    !Number.isFinite(scaleSpeedup) ||
    scaleSpeedup < keyedFilterMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedFilterMinimumSnapshotSpeedup,
);
// Selection is a separate-state update whose value is compared with the exact row key. The unit
// suite deterministically requires at most two row-binding reads. This browser gate protects a
// substantial end-to-end win and rejects growth beyond the same normalized 2x scalability ceiling
// used by the complete workload. Style invalidation, event dispatch, and DOM observation remain in
// the measured boundary even though row-binding work is key-directed.
const keyedIdentityMinimumSpeedup = 10;
const keyedIdentityMaximumNormalizedGrowth = 2;
const keyedIdentityResults = ["static", "hybrid"].map((mode) => {
  const tableMedianMs = comparisons.table.select[mode].medianMs;
  const scaleMedianMs = comparisons.scale.select20k[mode].medianMs;
  const growth = scaleMedianMs / Math.max(tableMedianMs, timingResolutionFloorMs);
  return {
    growth,
    mode,
    normalizedGrowth: growth / 20,
    scaleMedianMs,
    speedup: comparisons.scale.select20k[`${mode}VsBaseline`].speedup,
    tableMedianMs,
  };
});
const keyedIdentityRegressions = keyedIdentityResults.filter(
  ({ normalizedGrowth, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedIdentityMinimumSpeedup ||
    !Number.isFinite(normalizedGrowth) ||
    normalizedGrowth > keyedIdentityMaximumNormalizedGrowth,
);
// A native Set membership update can change several keyed rows at once. The compiler snapshots the
// previous and next primitive members and touches only their symmetric difference. The unit suite
// verifies the exact read count; this browser gate protects the corresponding 20,000-row win.
const keyedMembershipMinimumSpeedup = 10;
const keyedMembershipMaximumNormalizedGrowth = 2;
const keyedMembershipResults = ["static", "hybrid"].map((mode) => {
  const tableMedianMs = comparisons.table.membership[mode].medianMs;
  const scaleMedianMs = comparisons.scale.membership20k[mode].medianMs;
  const growth = scaleMedianMs / Math.max(tableMedianMs, timingResolutionFloorMs);
  return {
    growth,
    mode,
    normalizedGrowth: growth / 20,
    scaleMedianMs,
    speedup: comparisons.scale.membership20k[`${mode}VsBaseline`].speedup,
    tableMedianMs,
  };
});
const keyedMembershipRegressions = keyedMembershipResults.filter(
  ({ normalizedGrowth, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMembershipMinimumSpeedup ||
    !Number.isFinite(normalizedGrowth) ||
    normalizedGrowth > keyedMembershipMaximumNormalizedGrowth,
);
// A native Map lookup binding is similarly key-directed, but its mapped primitive value can feed
// text, attributes, classes, or styles. Deterministic tests prove that only keys whose mapped value
// changed evaluate the binding; this gate protects the corresponding end-to-end win at scale.
const keyedMapLookupMinimumSpeedup = 10;
const keyedMapLookupMaximumNormalizedGrowth = 2;
const keyedMapLookupResults = ["static", "hybrid"].map((mode) => {
  const tableMedianMs = comparisons.table.mapLookup[mode].medianMs;
  const scaleMedianMs = comparisons.scale.mapLookup20k[mode].medianMs;
  const growth = scaleMedianMs / Math.max(tableMedianMs, timingResolutionFloorMs);
  return {
    growth,
    mode,
    normalizedGrowth: growth / 20,
    scaleMedianMs,
    speedup: comparisons.scale.mapLookup20k[`${mode}VsBaseline`].speedup,
    tableMedianMs,
  };
});
const keyedMapLookupRegressions = keyedMapLookupResults.filter(
  ({ normalizedGrowth, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedMapLookupMinimumSpeedup ||
    !Number.isFinite(normalizedGrowth) ||
    normalizedGrowth > keyedMapLookupMaximumNormalizedGrowth,
);
// Dense Set/Map operations still pay the application's immutable collection clone, but a proven
// updater carries its executed keys to the runtime. This gate ensures that a 20,000-entry
// collection does not restore the removed second snapshot scan or the full keyed-row scan.
const keyedCollectionDeltaMinimumSpeedup = 2;
const keyedCollectionDeltaMinimumSnapshotSpeedup = 1.5;
const keyedCollectionDeltaMaximumNormalizedGrowth = 2;
const keyedCollectionDeltaResults = [
  ["set", "denseMembership", "denseMembership20k", "snapshotMembership20k"],
  ["map", "denseMapLookup", "denseMapLookup20k", "snapshotMapLookup20k"],
].flatMap(([kind, tableMetric, scaleMetric, snapshotScaleMetric]) =>
  ["static", "hybrid"].map((mode) => {
    const tableMedianMs = comparisons.table[tableMetric][mode].medianMs;
    const scaleMedianMs = comparisons.scale[scaleMetric][mode].medianMs;
    const snapshotScaleMedianMs = comparisons.scale[snapshotScaleMetric][mode].medianMs;
    const growth = scaleMedianMs / Math.max(tableMedianMs, timingResolutionFloorMs);
    return {
      growth,
      kind,
      mode,
      normalizedGrowth: growth / 20,
      scaleMedianMs,
      snapshotScaleMedianMs,
      snapshotSpeedup: snapshotScaleMedianMs / scaleMedianMs,
      speedup: comparisons.scale[scaleMetric][`${mode}VsBaseline`].speedup,
      tableMedianMs,
    };
  }),
);
const keyedCollectionDeltaRegressions = keyedCollectionDeltaResults.filter(
  ({ normalizedGrowth, snapshotSpeedup, speedup }) =>
    !Number.isFinite(speedup) ||
    speedup < keyedCollectionDeltaMinimumSpeedup ||
    !Number.isFinite(snapshotSpeedup) ||
    snapshotSpeedup < keyedCollectionDeltaMinimumSnapshotSpeedup ||
    !Number.isFinite(normalizedGrowth) ||
    normalizedGrowth > keyedCollectionDeltaMaximumNormalizedGrowth,
);
const passed =
  performanceRegressions.length === 0 &&
  scalabilityRegressions.length === 0 &&
  keyedUpdateRegressions.length === 0 &&
  keyedMultiMapUpdateRegressions.length === 0 &&
  keyedAppendRegressions.length === 0 &&
  keyedPrependRegressions.length === 0 &&
  keyedSliceRegressions.length === 0 &&
  keyedRollingWindowRegressions.length === 0 &&
  keyedMappedRollingWindowRegressions.length === 0 &&
  keyedMappedRollingWindowChainRegressions.length === 0 &&
  keyedQueuedRollingWindowRegressions.length === 0 &&
  keyedBatchInsertRegressions.length === 0 &&
  keyedWindowReplaceRegressions.length === 0 &&
  keyedWindowReuseRegressions.length === 0 &&
  keyedWindowResizeReuseRegressions.length === 0 &&
  keyedQueuedWindowResizeRegressions.length === 0 &&
  keyedWindowRefreshRegressions.length === 0 &&
  keyedQueuedWindowRefreshRegressions.length === 0 &&
  keyedQueuedWindowReplaceRegressions.length === 0 &&
  keyedPositionRegressions.length === 0 &&
  keyedRangeRemovalRegressions.length === 0 &&
  keyedReorderRegressions.length === 0 &&
  keyedQueuedReorderRegressions.length === 0 &&
  keyedReorderPipelineRegressions.length === 0 &&
  keyedStructuralReorderRegressions.length === 0 &&
  keyedStructuralAppendRegressions.length === 0 &&
  keyedStructuralPrependRegressions.length === 0 &&
  keyedStructuralPrependMapRegressions.length === 0 &&
  keyedStructuralAppendMapRegressions.length === 0 &&
  keyedFilterAppendMapRegressions.length === 0 &&
  keyedFilterMapAppendRegressions.length === 0 &&
  keyedMappedStructuralReorderRegressions.length === 0 &&
  keyedMapReorderRegressions.length === 0 &&
  keyedMultiMapReorderRegressions.length === 0 &&
  keyedMultiMapReverseRegressions.length === 0 &&
  keyedMappedReverseParityRegressions.length === 0 &&
  keyedQueuedMapReverseParityRegressions.length === 0 &&
  keyedReorderThenMapRegressions.length === 0 &&
  keyedQueuedReorderThenMapRegressions.length === 0 &&
  keyedQueuedMapThenReorderRegressions.length === 0 &&
  keyedQueuedMapReorderChainRegressions.length === 0 &&
  keyedSortRegressions.length === 0 &&
  keyedFilterRegressions.length === 0 &&
  keyedIdentityRegressions.length === 0 &&
  keyedMembershipRegressions.length === 0 &&
  keyedMapLookupRegressions.length === 0 &&
  keyedCollectionDeltaRegressions.length === 0;

const report = {
  result: passed ? "PASS" : "CORRECTNESS_PASS_PERFORMANCE_REGRESSION",
  correctness: "PASS",
  performanceGate: {
    regressions: performanceRegressions,
    status: performanceRegressions.length === 0 ? "PASS" : "FAIL",
    toleranceMs: performanceToleranceMs,
    thresholdPercent: performanceThresholdPercent,
  },
  optimizationPersistenceGate: {
    minimumSpeedup: keyedUpdateMinimumSpeedup,
    regressions: keyedUpdateRegressions,
    speedups: keyedUpdateSpeedups,
    status: keyedUpdateRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMultiMapUpdateHintGate: {
    minimumSnapshotSpeedup: keyedMultiMapUpdateMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMultiMapUpdateMinimumSpeedup,
    regressions: keyedMultiMapUpdateRegressions,
    results: keyedMultiMapUpdateResults,
    status: keyedMultiMapUpdateRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedAppendHintGate: {
    minimumSnapshotSpeedup: keyedAppendMinimumSnapshotSpeedup,
    minimumSpeedup: keyedAppendMinimumSpeedup,
    regressions: keyedAppendRegressions,
    results: keyedAppendResults,
    status: keyedAppendRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedPrependHintGate: {
    minimumSnapshotSpeedup: keyedPrependMinimumSnapshotSpeedup,
    minimumSpeedup: keyedPrependMinimumSpeedup,
    regressions: keyedPrependRegressions,
    results: keyedPrependResults,
    status: keyedPrependRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedSliceHintGate: {
    minimumSnapshotSpeedup: keyedSliceMinimumSnapshotSpeedup,
    minimumSpeedup: keyedSliceMinimumSpeedup,
    regressions: keyedSliceRegressions,
    results: keyedSliceResults,
    status: keyedSliceRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedRollingWindowHintGate: {
    minimumSnapshotSpeedup: keyedRollingWindowMinimumSnapshotSpeedup,
    minimumSpeedup: keyedRollingWindowMinimumSpeedup,
    regressions: keyedRollingWindowRegressions,
    results: keyedRollingWindowResults,
    status: keyedRollingWindowRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMappedRollingWindowHintGate: {
    minimumSnapshotSpeedup: keyedMappedRollingWindowMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMappedRollingWindowMinimumSpeedup,
    regressions: keyedMappedRollingWindowRegressions,
    results: keyedMappedRollingWindowResults,
    status: keyedMappedRollingWindowRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMappedRollingWindowChainHintGate: {
    minimumSnapshotSpeedup: keyedMappedRollingWindowChainMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMappedRollingWindowChainMinimumSpeedup,
    regressions: keyedMappedRollingWindowChainRegressions,
    results: keyedMappedRollingWindowChainResults,
    status: keyedMappedRollingWindowChainRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedRollingWindowHintGate: {
    minimumSnapshotSpeedup: keyedQueuedRollingWindowMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedRollingWindowMinimumSpeedup,
    regressions: keyedQueuedRollingWindowRegressions,
    results: keyedQueuedRollingWindowResults,
    status: keyedQueuedRollingWindowRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedBatchInsertHintGate: {
    minimumSnapshotSpeedup: keyedBatchInsertMinimumSnapshotSpeedup,
    minimumSpeedup: keyedBatchInsertMinimumSpeedup,
    regressions: keyedBatchInsertRegressions,
    results: keyedBatchInsertResults,
    status: keyedBatchInsertRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedWindowReplaceHintGate: {
    minimumSnapshotSpeedup: keyedWindowReplaceMinimumSnapshotSpeedup,
    minimumSpeedup: keyedWindowReplaceMinimumSpeedup,
    regressions: keyedWindowReplaceRegressions,
    results: keyedWindowReplaceResults,
    status: keyedWindowReplaceRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedWindowReuseHintGate: {
    minimumSnapshotSpeedup: keyedWindowReuseMinimumSnapshotSpeedup,
    minimumSpeedup: keyedWindowReuseMinimumSpeedup,
    regressions: keyedWindowReuseRegressions,
    results: keyedWindowReuseResults,
    status: keyedWindowReuseRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedWindowResizeReuseHintGate: {
    minimumSnapshotSpeedup: keyedWindowResizeReuseMinimumSnapshotSpeedup,
    minimumSpeedup: keyedWindowResizeReuseMinimumSpeedup,
    regressions: keyedWindowResizeReuseRegressions,
    results: keyedWindowResizeReuseResults,
    status: keyedWindowResizeReuseRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedWindowResizeHintGate: {
    minimumSnapshotSpeedup: keyedQueuedWindowResizeMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedWindowResizeMinimumSpeedup,
    regressions: keyedQueuedWindowResizeRegressions,
    results: keyedQueuedWindowResizeResults,
    status: keyedQueuedWindowResizeRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedWindowRefreshHintGate: {
    minimumSnapshotSpeedup: keyedWindowRefreshMinimumSnapshotSpeedup,
    minimumSpeedup: keyedWindowRefreshMinimumSpeedup,
    regressions: keyedWindowRefreshRegressions,
    results: keyedWindowRefreshResults,
    status: keyedWindowRefreshRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedWindowRefreshHintGate: {
    minimumSnapshotSpeedup: keyedQueuedWindowRefreshMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedWindowRefreshMinimumSpeedup,
    regressions: keyedQueuedWindowRefreshRegressions,
    results: keyedQueuedWindowRefreshResults,
    status: keyedQueuedWindowRefreshRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedWindowReplaceHintGate: {
    minimumSnapshotSpeedup: keyedQueuedWindowReplaceMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedWindowReplaceMinimumSpeedup,
    regressions: keyedQueuedWindowReplaceRegressions,
    results: keyedQueuedWindowReplaceResults,
    status: keyedQueuedWindowReplaceRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedPositionHintGate: {
    insertMinimumSnapshotSpeedup: keyedPositionInsertMinimumSnapshotSpeedup,
    insertMinimumSpeedup: keyedPositionInsertMinimumSpeedup,
    regressions: keyedPositionRegressions,
    removeMinimumSnapshotSpeedup: keyedPositionRemoveMinimumSnapshotSpeedup,
    removeMinimumSpeedup: keyedPositionRemoveMinimumSpeedup,
    replaceMinimumSnapshotSpeedup: keyedPositionReplaceMinimumSnapshotSpeedup,
    replaceMinimumSpeedup: keyedPositionReplaceMinimumSpeedup,
    results: keyedPositionResults,
    status: keyedPositionRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedRangeRemovalHintGate: {
    minimumSnapshotSpeedup: keyedRangeRemovalMinimumSnapshotSpeedup,
    minimumSpeedup: keyedRangeRemovalMinimumSpeedup,
    regressions: keyedRangeRemovalRegressions,
    results: keyedRangeRemovalResults,
    status: keyedRangeRemovalRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedReorderHintGate: {
    minimumSnapshotSpeedup: keyedReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedReorderMinimumSpeedup,
    regressions: keyedReorderRegressions,
    results: keyedReorderResults,
    status: keyedReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedReorderHintGate: {
    minimumSnapshotSpeedup: keyedQueuedReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedReorderMinimumSpeedup,
    regressions: keyedQueuedReorderRegressions,
    results: keyedQueuedReorderResults,
    status: keyedQueuedReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedReorderPipelineHintGate: {
    minimumSnapshotSpeedup: keyedReorderPipelineMinimumSnapshotSpeedup,
    minimumSpeedup: keyedReorderPipelineMinimumSpeedup,
    regressions: keyedReorderPipelineRegressions,
    results: keyedReorderPipelineResults,
    status: keyedReorderPipelineRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedStructuralReorderHintGate: {
    minimumSnapshotSpeedup: keyedStructuralReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedStructuralReorderMinimumSpeedup,
    regressions: keyedStructuralReorderRegressions,
    results: keyedStructuralReorderResults,
    status: keyedStructuralReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedStructuralAppendHintGate: {
    minimumSnapshotSpeedup: keyedStructuralAppendMinimumSnapshotSpeedup,
    minimumSpeedup: keyedStructuralAppendMinimumSpeedup,
    regressions: keyedStructuralAppendRegressions,
    results: keyedStructuralAppendResults,
    status: keyedStructuralAppendRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedStructuralPrependHintGate: {
    minimumSnapshotSpeedup: keyedStructuralPrependMinimumSnapshotSpeedup,
    minimumSpeedup: keyedStructuralPrependMinimumSpeedup,
    regressions: keyedStructuralPrependRegressions,
    results: keyedStructuralPrependResults,
    status: keyedStructuralPrependRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedStructuralPrependMapHintGate: {
    minimumSnapshotSpeedup: keyedStructuralPrependMapMinimumSnapshotSpeedup,
    minimumSpeedup: keyedStructuralPrependMapMinimumSpeedup,
    regressions: keyedStructuralPrependMapRegressions,
    results: keyedStructuralPrependMapResults,
    status: keyedStructuralPrependMapRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedStructuralAppendMapHintGate: {
    minimumSnapshotSpeedup: keyedStructuralAppendMapMinimumSnapshotSpeedup,
    minimumSpeedup: keyedStructuralAppendMapMinimumSpeedup,
    regressions: keyedStructuralAppendMapRegressions,
    results: keyedStructuralAppendMapResults,
    status: keyedStructuralAppendMapRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedFilterAppendMapHintGate: {
    minimumSnapshotSpeedup: keyedFilterAppendMapMinimumSnapshotSpeedup,
    minimumSpeedup: keyedFilterAppendMapMinimumSpeedup,
    regressions: keyedFilterAppendMapRegressions,
    results: keyedFilterAppendMapResults,
    status: keyedFilterAppendMapRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedFilterMapAppendHintGate: {
    minimumSnapshotSpeedup: keyedFilterMapAppendMinimumSnapshotSpeedup,
    minimumSpeedup: keyedFilterMapAppendMinimumSpeedup,
    regressions: keyedFilterMapAppendRegressions,
    results: keyedFilterMapAppendResults,
    status: keyedFilterMapAppendRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMappedStructuralReorderHintGate: {
    minimumSnapshotSpeedup: keyedMappedStructuralReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMappedStructuralReorderMinimumSpeedup,
    regressions: keyedMappedStructuralReorderRegressions,
    results: keyedMappedStructuralReorderResults,
    status: keyedMappedStructuralReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMapReorderHintGate: {
    minimumSnapshotSpeedup: keyedMapReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMapReorderMinimumSpeedup,
    regressions: keyedMapReorderRegressions,
    results: keyedMapReorderResults,
    status: keyedMapReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMultiMapReorderHintGate: {
    minimumSnapshotSpeedup: keyedMultiMapReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMultiMapReorderMinimumSpeedup,
    regressions: keyedMultiMapReorderRegressions,
    results: keyedMultiMapReorderResults,
    status: keyedMultiMapReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMultiMapReverseHintGate: {
    minimumSnapshotSpeedup: keyedMultiMapReverseMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMultiMapReverseMinimumSpeedup,
    regressions: keyedMultiMapReverseRegressions,
    results: keyedMultiMapReverseResults,
    status: keyedMultiMapReverseRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMappedReverseParityHintGate: {
    minimumSnapshotSpeedup: keyedMappedReverseParityMinimumSnapshotSpeedup,
    minimumSpeedup: keyedMappedReverseParityMinimumSpeedup,
    regressions: keyedMappedReverseParityRegressions,
    results: keyedMappedReverseParityResults,
    status: keyedMappedReverseParityRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedMapReverseParityHintGate: {
    minimumSnapshotSpeedup: keyedQueuedMapReverseParityMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedMapReverseParityMinimumSpeedup,
    regressions: keyedQueuedMapReverseParityRegressions,
    results: keyedQueuedMapReverseParityResults,
    status: keyedQueuedMapReverseParityRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedReorderThenMapHintGate: {
    minimumSnapshotSpeedup: keyedReorderThenMapMinimumSnapshotSpeedup,
    minimumSpeedup: keyedReorderThenMapMinimumSpeedup,
    regressions: keyedReorderThenMapRegressions,
    results: keyedReorderThenMapResults,
    status: keyedReorderThenMapRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedReorderThenMapHintGate: {
    minimumSnapshotSpeedup: keyedQueuedReorderThenMapMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedReorderThenMapMinimumSpeedup,
    regressions: keyedQueuedReorderThenMapRegressions,
    results: keyedQueuedReorderThenMapResults,
    status: keyedQueuedReorderThenMapRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedMapThenReorderHintGate: {
    minimumSnapshotSpeedup: keyedQueuedMapThenReorderMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedMapThenReorderMinimumSpeedup,
    regressions: keyedQueuedMapThenReorderRegressions,
    results: keyedQueuedMapThenReorderResults,
    status: keyedQueuedMapThenReorderRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedQueuedMapReorderChainHintGate: {
    minimumSnapshotSpeedup: keyedQueuedMapReorderChainMinimumSnapshotSpeedup,
    minimumSpeedup: keyedQueuedMapReorderChainMinimumSpeedup,
    regressions: keyedQueuedMapReorderChainRegressions,
    results: keyedQueuedMapReorderChainResults,
    status: keyedQueuedMapReorderChainRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedSortHintGate: {
    minimumSnapshotSpeedup: keyedSortMinimumSnapshotSpeedup,
    minimumSpeedup: keyedSortMinimumSpeedup,
    regressions: keyedSortRegressions,
    results: keyedSortResults,
    status: keyedSortRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedFilterHintGate: {
    minimumSnapshotSpeedup: keyedFilterMinimumSnapshotSpeedup,
    minimumSpeedup: keyedFilterMinimumSpeedup,
    regressions: keyedFilterRegressions,
    results: keyedFilterResults,
    status: keyedFilterRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedIdentityTargetGate: {
    maximumNormalizedGrowth: keyedIdentityMaximumNormalizedGrowth,
    minimumSpeedup: keyedIdentityMinimumSpeedup,
    regressions: keyedIdentityRegressions,
    results: keyedIdentityResults,
    status: keyedIdentityRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMembershipTargetGate: {
    maximumNormalizedGrowth: keyedMembershipMaximumNormalizedGrowth,
    minimumSpeedup: keyedMembershipMinimumSpeedup,
    regressions: keyedMembershipRegressions,
    results: keyedMembershipResults,
    status: keyedMembershipRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedMapLookupTargetGate: {
    maximumNormalizedGrowth: keyedMapLookupMaximumNormalizedGrowth,
    minimumSpeedup: keyedMapLookupMinimumSpeedup,
    regressions: keyedMapLookupRegressions,
    results: keyedMapLookupResults,
    status: keyedMapLookupRegressions.length === 0 ? "PASS" : "FAIL",
  },
  keyedCollectionDeltaGate: {
    maximumNormalizedGrowth: keyedCollectionDeltaMaximumNormalizedGrowth,
    minimumSpeedup: keyedCollectionDeltaMinimumSpeedup,
    minimumSnapshotSpeedup: keyedCollectionDeltaMinimumSnapshotSpeedup,
    regressions: keyedCollectionDeltaRegressions,
    results: keyedCollectionDeltaResults,
    status: keyedCollectionDeltaRegressions.length === 0 ? "PASS" : "FAIL",
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
    scalePeakRows: 21_000,
    tableRows: [1_000, 10_000, 11_000, 20_000, 21_000],
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
if (!passed) process.exitCode = 1;
