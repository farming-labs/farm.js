import { spawn } from "node:child_process";
import { rm, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 46310);
const warmupIterations = 5;
const measuredIterations = Number(process.env.BENCH_ITERATIONS || 25);
const actions = ["create", "update", "select", "swap", "clear"];

function percentile(samples, fraction) {
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.round((sorted.length - 1) * fraction));
  return sorted[index];
}

function run(command, args, env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: benchmarkDir,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolvePromise(output);
      else rejectPromise(new Error(`${command} ${args.join(" ")} exited ${code}\n${output}`));
    });
  });
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const body = await response.text();
        if (body.includes("compiler-benchmark-v1")) return;
      }
    } catch {
      // server not up yet
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

async function measureVariant(label, compilerEnabled) {
  console.log(`\n== ${label} ==`);
  await rm(path.join(benchmarkDir, ".farm"), { recursive: true, force: true });

  const env = { FARM_BENCH_COMPILER: compilerEnabled ? "1" : "0" };
  console.log("building...");
  await run("npx", ["farm", "build", "--preset", "node-server"], env);

  if (compilerEnabled) {
    const report = JSON.parse(
      await readFile(path.join(benchmarkDir, ".farm/react-compiler.json"), "utf8"),
    );
    const benchModule = report.modules.find((entry) => entry.id.includes("bench"));
    if (!report.summary.compiled || !benchModule || benchModule.compiled.length === 0) {
      console.error("Compiler report:", JSON.stringify(report, null, 2));
      throw new Error(
        "The Bench component did not compile; the comparison would be meaningless. " +
          "See fallback reasons above.",
      );
    }
    console.log(
      `compiler proof: ${report.summary.compiled} compiled component(s), ` +
        `Bench compiled as [${benchModule.compiled.join(", ")}]`,
    );
  }

  const server = spawn("node", [".farm/.output/server/index.mjs"], {
    cwd: benchmarkDir,
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });

  try {
    await waitForServer(`http://127.0.0.1:${port}/`);

    const browser = await chromium.launch();
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "networkidle" });
    await page.waitForSelector("[data-bench-root=ready]");

    // Hydration check: the page is interactive when clicking create produces rows.
    await page.click("#create");
    await page.waitForSelector('[data-row-count="1000"]', { timeout: 10_000 });
    await page.click("#clear");
    await page.waitForSelector('[data-row-count="0"]');

    // A sample is the time from dispatching the click to the MutationObserver
    // callback for the resulting DOM writes. Both variants apply their DOM
    // work before that callback runs, and unlike rAF timing this is not
    // quantized to the display's frame boundaries.
    const measureAction = (id) =>
      page.evaluate(
        (buttonId) =>
          new Promise((resolvePromise) => {
            const button = document.getElementById(buttonId);
            const root = document.querySelector("[data-bench-root]");
            const observer = new MutationObserver(() => {
              observer.disconnect();
              resolvePromise(performance.now() - start);
            });
            observer.observe(root, {
              subtree: true,
              childList: true,
              attributes: true,
              characterData: true,
            });
            const start = performance.now();
            button.click();
          }),
        id,
      );

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const cpuNow = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      const value = (name) => metrics.find((metric) => metric.name === name)?.value ?? 0;
      return (
        (value("ScriptDuration") + value("RecalcStyleDuration") + value("LayoutDuration")) * 1000
      );
    };

    for (let iteration = 0; iteration < warmupIterations; iteration += 1) {
      for (const action of actions) await measureAction(action);
    }

    const samples = Object.fromEntries(actions.map((action) => [action, []]));
    const cpuStart = await cpuNow();
    for (let iteration = 0; iteration < measuredIterations; iteration += 1) {
      for (const action of actions) {
        samples[action].push(await measureAction(action));
      }
    }
    const cpuPerIteration = (await cpuNow() - cpuStart) / measuredIterations;

    await browser.close();

    const result = { cpuPerIteration };
    for (const action of actions) {
      result[action] = {
        p50: percentile(samples[action], 0.5),
        p95: percentile(samples[action], 0.95),
        samples: samples[action],
      };
      console.log(
        `${action.padEnd(7)} p50 ${result[action].p50.toFixed(2)}ms  p95 ${result[action].p95.toFixed(2)}ms`,
      );
    }
    console.log(
      `cpu (script+style+layout) per full iteration: ${cpuPerIteration.toFixed(2)}ms`,
    );
    return result;
  } catch (error) {
    console.error(serverLog.slice(-2000));
    throw error;
  } finally {
    server.kill("SIGTERM");
  }
}

const baseline = await measureVariant("baseline (compiler off)", false);
const compiled = await measureVariant("compiled (compiler on)", true);

const rows = actions.map((action) => {
  const speedup = baseline[action].p50 / compiled[action].p50;
  return {
    action,
    baselineP50: baseline[action].p50,
    baselineP95: baseline[action].p95,
    compiledP50: compiled[action].p50,
    compiledP95: compiled[action].p95,
    speedupP50: speedup,
  };
});

console.log("\n== comparison (p50) ==");
for (const row of rows) {
  console.log(
    `${row.action.padEnd(7)} baseline ${row.baselineP50.toFixed(2)}ms -> compiled ${row.compiledP50.toFixed(2)}ms  (${row.speedupP50.toFixed(2)}x)`,
  );
}
console.log(
  `cpu/iter baseline ${baseline.cpuPerIteration.toFixed(2)}ms -> compiled ${compiled.cpuPerIteration.toFixed(2)}ms  (${(baseline.cpuPerIteration / compiled.cpuPerIteration).toFixed(2)}x)`,
);

await mkdir(path.join(benchmarkDir, "results"), { recursive: true });
await writeFile(
  path.join(benchmarkDir, "results/latest.json"),
  `${JSON.stringify({ port, measuredIterations, baseline, compiled }, null, 2)}\n`,
);

const markdown = [
  "# Farm.js compiler benchmark",
  "",
  `${measuredIterations} measured iterations per action after ${warmupIterations} warmups, production build, Chromium.`,
  "Latency is click dispatch to the MutationObserver callback for the resulting DOM writes.",
  "",
  "| action | baseline p50 | compiled p50 | baseline p95 | compiled p95 | p50 speedup |",
  "| --- | --- | --- | --- | --- | --- |",
  ...rows.map(
    (row) =>
      `| ${row.action} | ${row.baselineP50.toFixed(2)}ms | ${row.compiledP50.toFixed(2)}ms | ${row.baselineP95.toFixed(2)}ms | ${row.compiledP95.toFixed(2)}ms | ${row.speedupP50.toFixed(2)}x |`,
  ),
  "",
  `CPU (script+style+layout) per full action cycle: baseline ${baseline.cpuPerIteration.toFixed(2)}ms, compiled ${compiled.cpuPerIteration.toFixed(2)}ms (${(baseline.cpuPerIteration / compiled.cpuPerIteration).toFixed(2)}x).`,
  "",
].join("\n");
await writeFile(path.join(benchmarkDir, "results/latest.md"), `${markdown}\n`);
console.log("\nresults written to results/latest.json and results/latest.md");
