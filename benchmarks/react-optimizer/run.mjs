import { spawn } from "node:child_process";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchmarkDir, "../..");
const artifactDir = path.join(benchmarkDir, ".bench-artifacts");
const buildRoot = path.join(benchmarkDir, ".bench-dist");
const resultDir = path.join(benchmarkDir, "results");
const viteBin = path.join(
  benchmarkDir,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "vite.cmd" : "vite",
);

const measuredIterations = positiveInteger("BENCH_ITERATIONS", 20);
const trialCount = positiveInteger("BENCH_TRIALS", 5);
const warmupIterations = positiveInteger("BENCH_WARMUPS", 5);
const basePort = positiveInteger("BENCH_PORT", 46_740);
const actions = ["create", "update", "select", "swap", "append", "remove", "clear"];
const variants = [
  { id: "react", label: "React" },
  { id: "million-auto", label: "Million auto" },
  { id: "million-for", label: "Million For" },
  { id: "million-for-block", label: "Million For + block" },
  { id: "farm", label: "Farm AOT" },
];

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive integer.`);
  }
  return value;
}

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarize(samples) {
  return {
    mean: samples.reduce((total, value) => total + value, 0) / samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
  };
}

function formatMilliseconds(value) {
  return `${value.toFixed(2)}ms`;
}

function formatBytes(value) {
  return `${(value / 1024).toFixed(1)} KiB`;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd || benchmarkDir,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(`${command} ${args.join(" ")} exited ${code}\n${output}`));
    });
  });
}

async function readGitCommit() {
  return (await run("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).trim();
}

async function buildVariants() {
  await rm(artifactDir, { recursive: true, force: true });
  await rm(buildRoot, { recursive: true, force: true });
  await run("pnpm", ["--filter", "@farm.js/react", "build"], {
    cwd: repoRoot,
    env: { NODE_OPTIONS: "--max-old-space-size=8192" },
  });

  for (const variant of variants) {
    process.stdout.write(`Building ${variant.label}... `);
    await run(viteBin, ["build"], {
      env: { REACT_OPTIMIZER_VARIANT: variant.id },
    });
    console.log("done");
  }

  const farmReport = JSON.parse(await readFile(path.join(artifactDir, "farm-report.json"), "utf8"));
  const benchModule = farmReport.modules.find((entry) =>
    entry.id.replace(/\\/g, "/").endsWith("src/bench.tsx"),
  );
  if (!benchModule?.compiled.includes("Bench")) {
    throw new Error("Farm did not compile Bench; refusing a baseline-vs-baseline comparison.");
  }
  const farmChunks = (await listFiles(path.join(buildRoot, "farm"))).filter((file) =>
    file.endsWith(".js"),
  );
  const farmCode = (await Promise.all(farmChunks.map((file) => readFile(file, "utf8")))).join("\n");
  if (!farmCode.includes("FarmCompiledKeyedRows")) {
    throw new Error("Farm did not retain the keyed-row runtime in its production bundle.");
  }

  const millionAuto = JSON.parse(
    await readFile(path.join(artifactDir, "million-auto-proof.json"), "utf8"),
  );
  if (!millionAuto.compiled) {
    throw new Error("Million automatic mode did not compile; refusing an invalid comparison.");
  }
  const millionFor = JSON.parse(
    await readFile(path.join(artifactDir, "million-for-proof.json"), "utf8"),
  );
  if (!millionFor.manualPrimitives) {
    throw new Error("The manual Million For workload did not retain its documented primitive.");
  }
  const millionForBlock = JSON.parse(
    await readFile(path.join(artifactDir, "million-for-block-proof.json"), "utf8"),
  );
  if (!millionForBlock.manualPrimitives) {
    throw new Error("The manual Million For + block workload did not retain its primitives.");
  }

  return {
    farm: { compiled: benchModule.compiled, keyedRows: true },
    millionAuto,
    millionFor,
    millionForBlock,
  };
}

async function listFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await listFiles(filePath)));
    else output.push(filePath);
  }
  return output;
}

async function measureBundle(variant) {
  const directory = path.join(buildRoot, variant.id);
  const files = (await listFiles(directory)).filter((file) => file.endsWith(".js"));
  let raw = 0;
  let gzip = 0;
  let brotli = 0;
  for (const file of files) {
    const source = await readFile(file);
    raw += source.byteLength;
    gzip += gzipSync(source, { level: 9 }).byteLength;
    brotli += brotliCompressSync(source).byteLength;
  }
  return { brotli, files: files.length, gzip, raw };
}

function startServer(variant, index) {
  const port = basePort + index;
  const child = spawn(
    viteBin,
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    {
      cwd: benchmarkDir,
      env: { ...process.env, REACT_OPTIMIZER_VARIANT: variant.id },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return {
    child,
    output: () => output,
    url: `http://127.0.0.1:${port}/`,
    variant,
  };
}

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(`${server.variant.label} preview exited early:\n${server.output()}`);
    }
    try {
      const response = await fetch(server.url);
      if (response.ok) return;
    } catch {
      // The preview process is still starting.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`${server.variant.label} preview did not become ready:\n${server.output()}`);
}

async function measureAction(page, action) {
  return page.evaluate(
    ({ actionId }) =>
      new Promise((resolvePromise, rejectPromise) => {
        const button = document.getElementById(actionId);
        const root = document.querySelector("[data-bench-root]");
        if (!button || !root) {
          rejectPromise(new Error(`Missing benchmark target for ${actionId}.`));
          return;
        }
        const timeout = window.setTimeout(() => {
          observer.disconnect();
          rejectPromise(new Error(`No DOM mutation observed for ${actionId}.`));
        }, 10_000);
        const observer = new MutationObserver(() => {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolvePromise(performance.now() - startedAt);
        });
        observer.observe(root, {
          attributes: true,
          characterData: true,
          childList: true,
          subtree: true,
        });
        const startedAt = performance.now();
        button.click();
      }),
    { actionId: action },
  );
}

async function readCorrectness(page, action) {
  return page.evaluate((completedAction) => {
    const rows = [...document.querySelectorAll("[data-row-id]")];
    const ids = rows.map((row) => row.getAttribute("data-row-id"));
    const selected = rows.filter((row) => row.classList.contains("selected"));
    const labels = rows.map((row) => row.querySelector("strong")?.textContent || "");
    const benchmarkWindow = window;

    if (completedAction === "create") {
      const identity = new Map(rows.map((row) => [row.getAttribute("data-row-id"), row]));
      const input = rows[2]?.querySelector("input");
      if (input) {
        input.value = "typed by benchmark";
        input.focus();
        input.setSelectionRange(2, 7);
      }
      benchmarkWindow.__optimizerCorrectness = {
        identity,
        input,
        stableId: ids[2],
        swapLeft: ids[1],
        swapRight: ids[998],
      };
    }

    const control = benchmarkWindow.__optimizerCorrectness;
    const stableNode = control?.stableId
      ? document.querySelector(`[data-row-id="${control.stableId}"]`)
      : null;
    const input = control?.input;
    return {
      activeInputPreserved:
        completedAction === "create" || completedAction === "clear"
          ? true
          : document.activeElement === input,
      ids,
      labelsUpdated: labels.filter((label) => label.endsWith(" !!!")).length,
      rowCount: rows.length,
      selectedCount: selected.length,
      stableIdentityPreserved:
        completedAction === "create" || completedAction === "clear"
          ? true
          : stableNode === control?.identity.get(control?.stableId),
      swapLeft: control?.swapLeft,
      swapRight: control?.swapRight,
      typedInputPreserved:
        completedAction === "create" || completedAction === "clear"
          ? true
          : input?.value === "typed by benchmark" &&
            input.selectionStart === 2 &&
            input.selectionEnd === 7,
      uniqueIds: new Set(ids).size,
    };
  }, action);
}

function assertCorrectness(variant, action, state) {
  const prefix = `${variant.label} failed correctness after ${action}`;
  const expectedRows = {
    append: 1_100,
    clear: 0,
    create: 1_000,
    remove: 990,
    select: 1_000,
    swap: 1_000,
    update: 1_000,
  }[action];
  if (state.rowCount !== expectedRows || state.uniqueIds !== expectedRows) {
    throw new Error(
      `${prefix}: expected ${expectedRows} unique rows, received ${state.rowCount}/${state.uniqueIds}.`,
    );
  }
  if (action !== "create" && action !== "clear") {
    if (!state.stableIdentityPreserved) throw new Error(`${prefix}: keyed DOM identity changed.`);
    if (!state.typedInputPreserved) throw new Error(`${prefix}: uncontrolled input state changed.`);
    if (!state.activeInputPreserved) throw new Error(`${prefix}: focused input was replaced.`);
  }
  if (action === "update" && state.labelsUpdated !== 100) {
    throw new Error(`${prefix}: expected 100 updated labels, received ${state.labelsUpdated}.`);
  }
  if (action === "select" && state.selectedCount !== 1) {
    throw new Error(`${prefix}: expected exactly one selected row.`);
  }
  if (
    action === "swap" &&
    (state.ids[1] !== state.swapRight || state.ids[998] !== state.swapLeft)
  ) {
    throw new Error(`${prefix}: rows 1 and 998 were not swapped.`);
  }
}

async function runCorrectnessPass(page, variant) {
  for (const action of actions) {
    await measureAction(page, action);
    assertCorrectness(variant, action, await readCorrectness(page, action));
  }
}

async function validateVariant(browser, server) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || error.message));
  try {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-bench-root=ready]");
    await runCorrectnessPass(page, server.variant);
    return { passed: true, pageErrors };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      pageErrors,
      passed: false,
    };
  } finally {
    await context.close();
  }
}

async function cpuNow(cdp) {
  const { metrics } = await cdp.send("Performance.getMetrics");
  const value = (name) => metrics.find((metric) => metric.name === name)?.value || 0;
  return (value("ScriptDuration") + value("RecalcStyleDuration") + value("LayoutDuration")) * 1_000;
}

async function runTrial(browser, server, trial) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(server.url, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-bench-root=ready]");

    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      for (const action of actions) await measureAction(page, action);
    }

    const cdp = await context.newCDPSession(page);
    await cdp.send("Performance.enable");
    const cpuStart = await cpuNow(cdp);
    const samples = Object.fromEntries(actions.map((action) => [action, []]));
    for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
      for (const action of actions) {
        samples[action].push(await measureAction(page, action));
      }
    }
    const cpuPerCycle = ((await cpuNow(cdp)) - cpuStart) / measuredIterations;

    await cdp.send("HeapProfiler.enable");
    await cdp.send("HeapProfiler.collectGarbage");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const heapUsedBytes = metrics.find((metric) => metric.name === "JSHeapUsedSize")?.value || 0;
    const counters = await cdp.send("Memory.getDOMCounters");
    console.log(
      `  trial ${trial + 1}: ${server.variant.label.padEnd(20)} ` +
        `CPU ${formatMilliseconds(cpuPerCycle)}  heap ${formatBytes(heapUsedBytes)}`,
    );
    return { cpuPerCycle, heapUsedBytes, ...counters, samples };
  } finally {
    await context.close();
  }
}

function aggregateVariant(trials, bundle) {
  const latency = {};
  for (const action of actions) {
    latency[action] = summarize(trials.flatMap((trial) => trial.samples[action]));
  }
  return {
    bundle,
    cpuPerCycle: summarize(trials.map((trial) => trial.cpuPerCycle)),
    documents: summarize(trials.map((trial) => trial.documents)),
    heapUsedBytes: summarize(trials.map((trial) => trial.heapUsedBytes)),
    jsEventListeners: summarize(trials.map((trial) => trial.jsEventListeners)),
    latency,
    nodes: summarize(trials.map((trial) => trial.nodes)),
    status: "passed",
    trials,
  };
}

function comparisonRows(results) {
  return actions.map((action) => ({
    action,
    farm: results.farm.latency[action].p50,
    farmVsMillionAuto:
      results["million-auto"].latency[action].p50 / results.farm.latency[action].p50,
    millionAuto: results["million-auto"].latency[action].p50,
    millionFor:
      results["million-for"].status === "passed"
        ? results["million-for"].latency[action].p50
        : undefined,
    react: results.react.latency[action].p50,
  }));
}

function renderMarkdown(metadata, results, validation) {
  const rows = comparisonRows(results);
  const cpuSpeedup = results["million-auto"].cpuPerCycle.p50 / results.farm.cpuPerCycle.p50;
  const passingVariants = variants
    .filter((variant) => validation[variant.id].passed)
    .map((variant) => variant.label)
    .join(", ");
  return [
    "# React optimizer benchmark",
    "",
    `Farm commit: ${metadata.farmCommit}`,
    `Runtime: ${metadata.node}, ${metadata.platform}, ${metadata.cpu}`,
    `Browser: Chromium ${metadata.chromium}`,
    `${trialCount} trials × ${measuredIterations} measured cycles after ${warmupIterations} warmups.`,
    "",
    `${passingVariants} passed row output, keyed DOM identity, uncontrolled input, focus, and selection controls.`,
    "The Million For variants use documented manual source. Any variant that fails correctness is excluded from timing.",
    "",
    "| action | React p50 | Million auto p50 | Million For p50 | Farm AOT p50 | Farm vs Million auto |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...rows.map(
      (row) =>
        `| ${row.action} | ${formatMilliseconds(row.react)} | ${formatMilliseconds(row.millionAuto)} | ${row.millionFor === undefined ? "correctness failed" : formatMilliseconds(row.millionFor)} | ${formatMilliseconds(row.farm)} | ${row.farmVsMillionAuto.toFixed(2)}x |`,
    ),
    "",
    "| variant | CPU/cycle p50 | CPU/cycle p95 | heap after GC p50 | JS gzip | JS Brotli |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...variants.map((variant) => {
      const result = results[variant.id];
      if (result.status !== "passed") {
        return `| ${variant.label} | correctness failed | correctness failed | n/a | ${formatBytes(result.bundle.gzip)} | ${formatBytes(result.bundle.brotli)} |`;
      }
      return `| ${variant.label} | ${formatMilliseconds(result.cpuPerCycle.p50)} | ${formatMilliseconds(result.cpuPerCycle.p95)} | ${formatBytes(result.heapUsedBytes.p50)} | ${formatBytes(result.bundle.gzip)} | ${formatBytes(result.bundle.brotli)} |`;
    }),
    "",
    `Farm CPU speedup over Million auto: ${cpuSpeedup.toFixed(2)}x.`,
    validation["million-for"].passed
      ? `Farm CPU speedup over Million For: ${(results["million-for"].cpuPerCycle.p50 / results.farm.cpuPerCycle.p50).toFixed(2)}x.`
      : `Million For correctness failure: ${validation["million-for"].error}`,
    ...validation["million-for"].pageErrors.map((error) => `Browser error: ${error}`),
    validation["million-for-block"].passed
      ? "Million For + block passed the correctness control."
      : `Million For + block correctness failure: ${validation["million-for-block"].error}`,
    ...validation["million-for-block"].pageErrors.map((error) => `Browser error: ${error}`),
    "",
    "A value above 1.00x in the final latency column means Farm completed that action faster.",
    "Raw per-action and per-trial samples are stored in latest.json.",
    "",
  ].join("\n");
}

await mkdir(resultDir, { recursive: true });
console.log("Building and proving optimizer output...");
const proof = await buildVariants();
const bundles = Object.fromEntries(
  await Promise.all(variants.map(async (variant) => [variant.id, await measureBundle(variant)])),
);

const servers = variants.map(startServer);
try {
  await Promise.all(servers.map(waitForServer));
  const browser = await chromium.launch({ headless: true });
  const trialResults = Object.fromEntries(variants.map((variant) => [variant.id, []]));
  try {
    console.log("Running correctness controls...");
    const validation = Object.fromEntries(
      await Promise.all(
        servers.map(async (server) => {
          const result = await validateVariant(browser, server);
          console.log(
            `  ${server.variant.label.padEnd(20)} ${result.passed ? "passed" : "failed"}`,
          );
          return [server.variant.id, result];
        }),
      ),
    );
    for (const required of ["react", "million-auto", "farm"]) {
      if (!validation[required].passed) {
        throw new Error(
          `${required} failed the correctness control: ${validation[required].error}\n` +
            validation[required].pageErrors.join("\n"),
        );
      }
    }
    const measuredServers = servers.filter((server) => validation[server.variant.id].passed);

    for (let trial = 0; trial < trialCount; trial += 1) {
      console.log(`Trial ${trial + 1}/${trialCount}`);
      const offset = trial % measuredServers.length;
      const order = [...measuredServers.slice(offset), ...measuredServers.slice(0, offset)];
      for (const server of order) {
        trialResults[server.variant.id].push(await runTrial(browser, server, trial));
      }
    }

    const results = Object.fromEntries(
      variants.map((variant) => {
        if (!validation[variant.id].passed) {
          return [
            variant.id,
            {
              bundle: bundles[variant.id],
              error: validation[variant.id].error,
              pageErrors: validation[variant.id].pageErrors,
              status: "failed-correctness",
            },
          ];
        }
        return [variant.id, aggregateVariant(trialResults[variant.id], bundles[variant.id])];
      }),
    );
    const metadata = {
      cpu: os.cpus()[0]?.model || "unknown CPU",
      chromium: browser.version(),
      farmCommit: await readGitCommit(),
      node: process.version,
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      proof,
      versions: {
        million: "3.1.11",
        react: "19.2.8",
        vite: "5.4.20",
      },
    };
    const output = {
      actions,
      measuredIterations,
      metadata,
      results,
      trialCount,
      validation,
      warmupIterations,
    };
    await writeFile(path.join(resultDir, "latest.json"), `${JSON.stringify(output, null, 2)}\n`);
    const markdown = renderMarkdown(metadata, results, validation);
    await writeFile(path.join(resultDir, "latest.md"), `${markdown}\n`);
    console.log(`\n${markdown}`);
    console.log("Results written to results/latest.json and results/latest.md");
  } finally {
    await browser.close();
  }
} finally {
  for (const server of servers) server.child.kill("SIGTERM");
}
