import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const benchmarkDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(benchmarkDir, "../..");
const farmCorePackage = JSON.parse(
  await fs.readFile(path.join(repoRoot, "packages/farm/package.json"), "utf8"),
);
const farmCliPackage = JSON.parse(
  await fs.readFile(path.join(repoRoot, "packages/farm-cli/package.json"), "utf8"),
);
const appsRoot = path.join(benchmarkDir, "apps");
const resultsDir = path.join(benchmarkDir, "results");
const benchmarkGitPath = path.relative(repoRoot, benchmarkDir).split(path.sep).join("/");
const lockPath = path.join(benchmarkDir, ".benchmark.lock");
const marker = "framework-benchmark-v1";
const basePort = 46100;
const processTimeoutMs = 8 * 60 * 1000;
const readinessPollIntervalMs = 2;
const activeChildren = new Set();
let shuttingDown = false;
let benchmarkLockHandle;
const require = createRequire(import.meta.url);

const sanitizedEnvironmentKeys = new Set([
  "BABEL_ENV",
  "BODY_SIZE_LIMIT",
  "BROWSERSLIST",
  "DEBUG",
  "FORCE_COLOR",
  "HOST",
  "HOST_HEADER",
  "NODE_COMPILE_CACHE",
  "NODE_COMPILE_CACHE_PORTABLE",
  "NODE_DEBUG",
  "NODE_DISABLE_COMPILE_CACHE",
  "NODE_ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "ORIGIN",
  "PORT",
  "PROTOCOL_HEADER",
  "XFF_DEPTH",
]);
const sanitizedEnvironmentPrefixes = [
  "__NEXT_",
  "BROWSERSLIST_",
  "ESBUILD_",
  "FARM_",
  "NEXT_",
  "NEXT_PRIVATE_",
  "NITRO_",
  "NUXT_",
  "ROLLDOWN_",
  "ROLLUP_",
  "RSPACK_",
  "RUST_",
  "SVELTE_",
  "SVELTEKIT_",
  "SWC_",
  "TANSTACK_",
  "TSR_",
  "TURBO_",
  "TURBOPACK_",
  "VITE_",
];

function shouldForwardEnvironmentVariable(key) {
  return (
    !sanitizedEnvironmentKeys.has(key) &&
    !sanitizedEnvironmentPrefixes.some((prefix) => key.startsWith(prefix))
  );
}

const sanitizedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => shouldForwardEnvironmentVariable(key)),
);

const baseEnv = {
  ...sanitizedEnvironment,
  PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH || ""),
  CI: "1",
  NEXT_TELEMETRY_DISABLED: "1",
  NUXT_TELEMETRY_DISABLED: "1",
  NO_COLOR: "1",
  TZ: "UTC",
};

const frameworks = [
  {
    id: "farm",
    label: "Farm.js",
    version: farmCorePackage.version,
    stack: "React 19.2.4 · Vite 5.4.20 dev · Vite 8.1.5 (Rolldown) build",
    directory: "farm",
    devHost: "localhost",
    installedPackages: [
      { name: "@farm.js/core", version: farmCorePackage.version },
      { name: "@farm.js/cli", version: farmCliPackage.version },
      { name: "react", version: "19.2.4" },
      { name: "react-dom", version: "19.2.4" },
      { name: "sharp", version: "0.34.5" },
      { name: "vite", version: "5.4.20", from: "@farm.js/core" },
      { name: "vite-rolldown", version: "8.1.5", from: "@farm.js/core" },
    ],
    cli: "node_modules/@farm.js/cli/bin/farm.js",
    devArgs: (port) => ["dev", "--port", String(port)],
    buildArgs: () => ["build", "--preset", "node-server"],
    production: (port) => ({
      command: process.execPath,
      args: [".farm/.output/server/index.mjs"],
      env: { HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production" },
    }),
    outputEntry: ".farm/.output/server/index.mjs",
    clean: [
      ".farm",
      "node_modules/.vite",
      "src/farm-routes.d.ts",
      "src/farm-env.d.ts",
      "src/farm-images.d.ts",
      "src/lib/api.generated.ts",
    ],
  },
  {
    id: "next",
    label: "Next.js",
    version: "16.2.10",
    stack: "React 19.2.4 · Turbopack default",
    directory: "next",
    devHost: "localhost",
    installedPackages: [
      { name: "next", version: "16.2.10" },
      { name: "react", version: "19.2.4" },
      { name: "react-dom", version: "19.2.4" },
    ],
    cli: "node_modules/next/dist/bin/next",
    devArgs: (port) => ["dev", "-H", "localhost", "-p", String(port)],
    buildArgs: () => ["build"],
    production: (port, appDir) => ({
      command: process.execPath,
      args: [
        path.join(appDir, "node_modules/next/dist/bin/next"),
        "start",
        "-H",
        "127.0.0.1",
        "-p",
        String(port),
      ],
      env: { NODE_ENV: "production" },
    }),
    outputEntry: ".next/BUILD_ID",
    clean: [".next", "node_modules/.cache", "node_modules/.vite"],
  },
  {
    id: "sveltekit",
    label: "SvelteKit",
    version: "2.70.1",
    stack: "Svelte 5.56.7 · Vite 8.1.5",
    directory: "sveltekit",
    devHost: "localhost",
    installedPackages: [
      { name: "@sveltejs/kit", version: "2.70.1" },
      { name: "@sveltejs/adapter-node", version: "5.5.7" },
      { name: "svelte", version: "5.56.7" },
      { name: "vite", version: "8.1.5" },
    ],
    cli: "node_modules/vite/bin/vite.js",
    devArgs: (port) => ["dev", "--host", "localhost", "--port", String(port), "--strictPort"],
    buildArgs: () => ["build"],
    production: (port) => ({
      command: process.execPath,
      args: ["build/index.js"],
      env: { HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production" },
    }),
    outputEntry: "build/index.js",
    clean: [".svelte-kit", "build", "node_modules/.vite"],
  },
  {
    id: "nuxt",
    label: "Nuxt",
    version: "4.5.0",
    stack: "Vue 3.5.40 · Vite default",
    directory: "nuxt",
    devHost: "localhost",
    installedPackages: [
      { name: "nuxt", version: "4.5.0" },
      { name: "vue", version: "3.5.40", from: "nuxt" },
      { name: "vite", version: "8.1.5", from: "nuxt" },
    ],
    cli: "node_modules/nuxt/bin/nuxt.mjs",
    devArgs: (port) => ["dev", "--host", "localhost", "--port", String(port)],
    buildArgs: () => ["build"],
    production: (port) => ({
      command: process.execPath,
      args: [".output/server/index.mjs"],
      env: { HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production" },
    }),
    outputEntry: ".output/server/index.mjs",
    clean: [".nuxt", ".output", "node_modules/.cache", "node_modules/.vite"],
  },
  {
    id: "tanstack",
    label: "TanStack Start",
    version: "1.168.32",
    stack: "React 19.2.4 · Vite 8.1.5",
    directory: "tanstack",
    devHost: "localhost",
    installedPackages: [
      { name: "@tanstack/react-start", version: "1.168.32" },
      { name: "@tanstack/react-router", version: "1.170.18" },
      { name: "react", version: "19.2.4" },
      { name: "react-dom", version: "19.2.4" },
      { name: "vite", version: "8.1.5" },
      { name: "nitro", version: "3.0.260610-beta" },
    ],
    cli: "node_modules/vite/bin/vite.js",
    devArgs: (port) => ["dev", "--host", "localhost", "--port", String(port), "--strictPort"],
    buildArgs: () => ["build"],
    production: (port) => ({
      command: process.execPath,
      args: [".output/server/index.mjs"],
      env: { HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "production" },
    }),
    outputEntry: ".output/server/index.mjs",
    clean: [
      ".nitro",
      ".output",
      ".tanstack",
      "node_modules/.nitro",
      "node_modules/.vite",
      "node_modules/.vite-temp",
    ],
  },
];

function parseIntegerOption(name, value) {
  if (typeof value !== "string" || !/^[+-]?\d+$/.test(value)) {
    throw new Error(name + " must be an integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(name + " must be a safe integer");
  }
  return parsed;
}

function parseOptions(argv) {
  const options = {
    runs: 7,
    requests: 30,
    warmups: 30,
    seed: 20260721,
    only: frameworks.map((framework) => framework.id),
    prepare: true,
    publish: false,
    burnIn: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const [name, inlineValue] = argument.split("=", 2);
    const nextValue = inlineValue ?? argv[index + 1];

    if (name === "--runs" || name === "--requests" || name === "--warmups" || name === "--seed") {
      if (inlineValue === undefined) index += 1;
      const key = name.slice(2);
      options[key] = parseIntegerOption(name, nextValue);
      continue;
    }

    if (name === "--only") {
      if (inlineValue === undefined) index += 1;
      options.only = nextValue
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      continue;
    }

    if (name === "--skip-prepare") {
      options.prepare = false;
      continue;
    }

    if (name === "--skip-burn-in") {
      options.burnIn = false;
      continue;
    }

    if (name === "--publish") {
      options.publish = true;
      continue;
    }

    if (name === "--help" || name === "-h") {
      printHelp();
      process.exit(0);
    }

    throw new Error("Unknown option: " + argument);
  }

  for (const key of ["runs", "requests", "warmups"]) {
    if (!Number.isInteger(options[key]) || options[key] < (key === "warmups" ? 0 : 1)) {
      throw new Error("--" + key + " must be a positive integer");
    }
  }
  if (!Number.isSafeInteger(options.seed)) {
    throw new Error("--seed must be a safe integer");
  }

  const unknown = options.only.filter((id) => !frameworks.some((framework) => framework.id === id));
  if (unknown.length) throw new Error("Unknown framework: " + unknown.join(", "));
  if (!options.only.length) throw new Error("Select at least one framework");

  if (options.publish) {
    const canonicalIds = frameworks.map((framework) => framework.id);
    const isCanonicalSet =
      options.only.length === canonicalIds.length &&
      canonicalIds.every((id) => options.only.includes(id));
    if (!isCanonicalSet || options.runs < 7 || options.requests < 30 || options.warmups < 30) {
      throw new Error(
        "Publishing requires all frameworks, at least 7 rounds, 30 requests, and 30 warmups",
      );
    }
    if (!options.burnIn) throw new Error("Publishing requires the unmeasured burn-in round");
    if (!options.prepare) {
      throw new Error("Publishing requires rebuilding the local Farm packages");
    }
  }
  return options;
}

function printHelp() {
  console.log(
    [
      "Framework benchmark",
      "",
      "Usage: node benchmarks/frameworks/run.mjs [options]",
      "",
      "  --runs N          cold dev/build/boot rounds (default: 7)",
      "  --requests N      measured requests per server and round (default: 30)",
      "  --warmups N       excluded warm-up requests per server and round (default: 30)",
      "  --only LIST       comma-separated framework ids",
      "  --seed N          deterministic round-order seed",
      "  --skip-prepare    skip the untimed local Farm package build",
      "  --skip-burn-in    skip the unmeasured OS-cache warm-up round",
      "  --publish         replace canonical raw, Markdown, and landing data",
      "  --self-check      validate harness invariants without running benchmarks",
    ].join("\n"),
  );
}

function assertSupportedNode(selected) {
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 19) || major % 2 !== 0) {
    throw new Error(
      "Use an even-numbered LTS Node release >=20.19 for comparable runs. Current: " +
        process.versions.node,
    );
  }

  if (selected.some((framework) => framework.id === "nuxt")) {
    const supportsNuxt =
      (major === 22 && minor >= 19) ||
      (major === 24 && minor >= 11) ||
      (major >= 26 && major % 2 === 0);
    if (!supportsNuxt) {
      throw new Error("Nuxt 4.5.0 requires Node 22.19+, 24.11+, or a newer even release");
    }
  }
}

function formatMs(value) {
  return value >= 1000 ? (value / 1000).toFixed(2) + "s" : value.toFixed(value < 10 ? 2 : 0) + "ms";
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.max(0, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index];
}

function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const round = (value) => Math.round(value * 100) / 100;
  return {
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    min: round(sorted[0] || 0),
    max: round(sorted[sorted.length - 1] || 0),
    samples: samples.map(round),
  };
}

function withoutSamples(summary) {
  const { samples: _samples, ...published } = summary;
  return published;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(values, seed) {
  const output = [...values];
  const random = createRandom(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [output[index], output[target]] = [output[target], output[index]];
  }
  return output;
}

function createBalancedRoundOrders(values, count, seed) {
  if (!values.length || count < 1) return [];
  const orders = [];

  for (let block = 0; orders.length < count; block += 1) {
    const blockSeed = (seed + Math.imul(block, 0x9e3779b1)) >>> 0;
    const base = shuffled(values, blockSeed);
    if (block % 2 === 1) base.reverse();

    for (let offset = 0; offset < base.length && orders.length < count; offset += 1) {
      orders.push(base.map((_, position) => base[(position + offset) % base.length]));
    }
  }

  return orders;
}

function assertPositionBalanced(orders, values) {
  if (!orders.length) throw new Error("The measured round schedule is empty");
  const expectedIds = new Set(values.map((value) => value.id));
  const positionCounts = new Map(
    values.map((value) => [value.id, Array.from({ length: values.length }, () => 0)]),
  );

  for (const order of orders) {
    const ids = order.map((value) => value.id);
    if (ids.length !== values.length || new Set(ids).size !== values.length) {
      throw new Error("Each measured round must contain every selected framework exactly once");
    }
    if (ids.some((id) => !expectedIds.has(id))) {
      throw new Error("The measured round schedule contains an unknown framework");
    }
    ids.forEach((id, position) => {
      positionCounts.get(id)[position] += 1;
    });
  }

  for (const [id, counts] of positionCounts) {
    if (Math.max(...counts) - Math.min(...counts) > 1) {
      throw new Error(
        "Measured round positions are not balanced for " + id + ": " + counts.join(", "),
      );
    }
  }
}

function runSelfChecks() {
  if (readinessPollIntervalMs > 2) {
    throw new Error("Readiness polling must retain single-digit millisecond precision");
  }

  for (const key of sanitizedEnvironmentKeys) {
    if (shouldForwardEnvironmentVariable(key)) {
      throw new Error("Benchmark-controlled environment variable was not sanitized: " + key);
    }
  }
  for (const key of [
    "__NEXT_PRIVATE_STANDALONE_CONFIG",
    "BROWSERSLIST_ENV",
    "ESBUILD_BINARY_PATH",
    "FARM_VITE_BUILDER",
    "NEXT_RUNTIME",
    "NEXT_PRIVATE_STANDALONE",
    "NITRO_BUILDER",
    "NITRO_PRESET",
    "NUXT_SOMETHING",
    "ROLLDOWN_OPTIONS_VALIDATION",
    "ROLLUP_WATCH",
    "RSPACK_CONFIG_VALIDATE",
    "RUST_LOG",
    "SVELTE_SOMETHING",
    "SVELTEKIT_SOMETHING",
    "SWC_BINARY_PATH",
    "TANSTACK_SOMETHING",
    "TSR_CONFIG",
    "TURBO_HASH",
    "TURBOPACK_LOG_LEVEL",
    "VITE_SOMETHING",
  ]) {
    if (shouldForwardEnvironmentVariable(key)) {
      throw new Error("Framework environment variable was not sanitized: " + key);
    }
  }
  for (const key of ["PATH", "SHELL", "TMPDIR"]) {
    if (!shouldForwardEnvironmentVariable(key)) {
      throw new Error("Ordinary process environment variable was unexpectedly sanitized: " + key);
    }
  }

  for (const value of ["not-a-number", "1.5", "9007199254740992"]) {
    let rejected = false;
    try {
      parseOptions(["--seed", value]);
    } catch (error) {
      rejected = error instanceof Error && error.message.startsWith("--seed must be");
    }
    if (!rejected) throw new Error("Invalid benchmark seed was accepted: " + value);
  }
  for (const value of ["-1", "0", "20260721"]) {
    if (parseOptions(["--seed", value]).seed !== Number(value)) {
      throw new Error("Valid benchmark seed was parsed incorrectly: " + value);
    }
  }

  const cleanIdentity = {
    benchmarkInputsDirty: false,
    farmSourceDirty: false,
    rootLockDirty: false,
  };
  assertPublishableRunIdentity(cleanIdentity);
  for (const key of Object.keys(cleanIdentity)) {
    let rejected = false;
    try {
      assertPublishableRunIdentity({ ...cleanIdentity, [key]: true });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error("Dirty publish identity was accepted: " + key);
  }

  for (let selectedCount = 1; selectedCount <= frameworks.length; selectedCount += 1) {
    const selected = frameworks.slice(0, selectedCount);
    for (let rounds = 1; rounds <= selectedCount * 3 + 2; rounds += 1) {
      const orders = createBalancedRoundOrders(selected, rounds, 20260721);
      assertPositionBalanced(orders, selected);
      const repeated = createBalancedRoundOrders(selected, rounds, 20260721);
      if (JSON.stringify(orders) !== JSON.stringify(repeated)) {
        throw new Error("Measured round schedules must be deterministic");
      }
    }
  }

  console.log("Benchmark harness self-checks passed");
}

function appendOutput(state, chunk) {
  state.value = (state.value + chunk.toString()).slice(-160000);
}

function spawnProcess(command, args, options = {}) {
  const output = { value: "" };
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: { ...baseEnv, ...options.env },
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  activeChildren.add(child);
  child.once("exit", () => activeChildren.delete(child));
  child.stdout.on("data", (chunk) => appendOutput(output, chunk));
  child.stderr.on("data", (chunk) => appendOutput(output, chunk));
  return { child, output };
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

function processTreeIsAlive(child) {
  if (!child.pid) return false;
  if (process.platform === "win32") return !hasExited(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function waitForProcessTreeExit(child, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (processTreeIsAlive(child) && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processTreeIsAlive(child);
}

async function stopProcess(child) {
  if (!child.pid || !processTreeIsAlive(child)) return;
  try {
    if (process.platform === "win32") child.kill("SIGTERM");
    else process.kill(-child.pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForProcessTreeExit(child, 1200)) return;
  try {
    if (process.platform === "win32") child.kill("SIGKILL");
    else process.kill(-child.pid, "SIGKILL");
  } catch {
    // Process exited between checks.
  }
  if (!(await waitForProcessTreeExit(child, 1200))) {
    throw new Error("Unable to stop benchmark process tree for PID " + child.pid);
  }
}

async function stopActiveChildren() {
  await Promise.all([...activeChildren].map((child) => stopProcess(child)));
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error("\nReceived " + signal + "; stopping benchmark servers...");
  await stopActiveChildren();
  await releaseBenchmarkLock();
  process.exit(128 + (signal === "SIGINT" ? 2 : 15));
}

async function acquireBenchmarkLock() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      benchmarkLockHandle = await fs.open(lockPath, "wx");
      await benchmarkLockHandle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + "\n",
      );
      return;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      let owner;
      try {
        owner = JSON.parse(await fs.readFile(lockPath, "utf8"));
      } catch {
        owner = null;
      }

      let ownerIsAlive = false;
      if (Number.isInteger(owner?.pid) && owner.pid > 0) {
        try {
          process.kill(owner.pid, 0);
          ownerIsAlive = true;
        } catch (ownerError) {
          if (ownerError?.code !== "ESRCH") ownerIsAlive = true;
        }
      }

      if (ownerIsAlive || attempt > 0) {
        throw new Error(
          "Another framework benchmark is active" +
            (owner?.pid ? " (PID " + owner.pid + ")" : "") +
            ".",
        );
      }
      await fs.rm(lockPath, { force: true });
    }
  }
}

async function releaseBenchmarkLock() {
  const handle = benchmarkLockHandle;
  benchmarkLockHandle = undefined;
  if (!handle) return;
  await handle.close().catch(() => {});
  await fs.rm(lockPath, { force: true });
}

function assertPortAvailable(host, port) {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.once("error", () =>
      reject(new Error("Benchmark port is already in use: " + host + ":" + port)),
    );
    server.listen({ host, port, exclusive: true }, () => server.close(resolve));
  });
}

async function runCommand(command, args, options = {}) {
  const startedAt = performance.now();
  const { child, output } = spawnProcess(command, args, options);
  const timeout = setTimeout(() => void stopProcess(child), options.timeoutMs || processTimeoutMs);
  const [exitCode, signal] = await once(child, "exit");
  clearTimeout(timeout);
  const durationMs = performance.now() - startedAt;
  if (exitCode !== 0) {
    throw new Error(
      "Command failed (" +
        String(exitCode ?? signal) +
        "): " +
        command +
        " " +
        args.join(" ") +
        "\n" +
        output.value,
    );
  }
  return { durationMs, output: output.value };
}

async function requestPage(url, timeoutMs = 60000) {
  const startedAt = performance.now();
  const response = await fetch(url, {
    cache: "no-store",
    headers: { connection: "close" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.text();
  const renderedAtMatch = body.match(/data-rendered-at="(\d+)"/);
  return {
    body,
    bytes: Buffer.byteLength(body),
    durationMs: performance.now() - startedAt,
    renderedAt: renderedAtMatch ? Number.parseInt(renderedAtMatch[1], 10) : null,
    status: response.status,
  };
}

function isValidFixtureResponse(response) {
  return (
    response.status === 200 &&
    response.body.includes(marker) &&
    response.body.includes('data-item-count="120"') &&
    Number.isFinite(response.renderedAt)
  );
}

async function waitForRenderedPage(child, output, url, startedAt) {
  const deadline = performance.now() + 180000;
  while (performance.now() < deadline) {
    if (hasExited(child)) {
      throw new Error("Server exited before rendering the fixture.\n" + output.value);
    }
    try {
      const response = await requestPage(url);
      if (isValidFixtureResponse(response)) {
        return {
          elapsedMs: performance.now() - startedAt,
          firstRequestMs: response.durationMs,
          responseBytes: response.bytes,
          renderedAt: response.renderedAt,
        };
      }
    } catch {
      // The port is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, readinessPollIntervalMs));
  }
  throw new Error("Timed out waiting for " + url + "\n" + output.value);
}

async function launchServer(command, args, options) {
  const parsedUrl = new URL(options.url);
  await assertPortAvailable(parsedUrl.hostname, Number.parseInt(parsedUrl.port, 10));
  const startedAt = performance.now();
  const { child, output } = spawnProcess(command, args, options);
  try {
    const ready = await waitForRenderedPage(child, output, options.url, startedAt);
    await new Promise((resolve) => setTimeout(resolve, 6));
    const dynamicResponse = await requestPage(options.url);
    if (
      !isValidFixtureResponse(dynamicResponse) ||
      dynamicResponse.renderedAt === ready.renderedAt
    ) {
      throw new Error("Fixture did not produce a fresh dynamic SSR response");
    }
    return { child, output, ready };
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

async function measureRequests(url, warmups, count) {
  for (let index = 0; index < warmups; index += 1) {
    const response = await requestPage(url);
    if (!isValidFixtureResponse(response)) {
      throw new Error("Fixture validation failed during warm-up");
    }
  }

  const samples = [];
  for (let index = 0; index < count; index += 1) {
    const response = await requestPage(url);
    if (!isValidFixtureResponse(response)) {
      throw new Error("Fixture validation failed during measured request");
    }
    samples.push(response.durationMs);
  }
  return samples;
}

async function cleanFramework(framework) {
  const appDir = path.join(appsRoot, framework.directory);
  for (const relativePath of framework.clean) {
    const target = path.resolve(appDir, relativePath);
    if (!target.startsWith(appDir + path.sep)) {
      throw new Error("Refusing to clean outside fixture: " + target);
    }
    await fs.rm(target, { force: true, recursive: true });
  }
}

async function assertInstalled(framework) {
  const appDir = path.join(appsRoot, framework.directory);
  await fs.access(path.join(appDir, framework.cli));

  for (const expected of framework.installedPackages) {
    let packageJsonPath;
    if (expected.from) {
      const parentDirectory = await fs.realpath(
        path.join(appDir, "node_modules", ...expected.from.split("/")),
      );
      packageJsonPath = require.resolve(expected.name + "/package.json", {
        paths: [parentDirectory],
      });
    } else {
      packageJsonPath = path.join(
        appDir,
        "node_modules",
        ...expected.name.split("/"),
        "package.json",
      );
    }
    const installed = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
    if (installed.version !== expected.version) {
      throw new Error(
        framework.label +
          " expected " +
          expected.name +
          " " +
          expected.version +
          ", but found " +
          String(installed.version),
      );
    }
  }
}

async function prepareFarm() {
  console.log("Preparing local Farm packages outside timed runs...");
  await runCommand("corepack", ["pnpm", "--filter", "@farm.js/core", "build"], {
    cwd: repoRoot,
  });
  await runCommand("corepack", ["pnpm", "--filter", "@farm.js/cli", "build"], {
    cwd: repoRoot,
  });
}

async function runRound(framework, round, options) {
  const appDir = path.join(appsRoot, framework.directory);
  const port = basePort + round * 20 + frameworks.findIndex((item) => item.id === framework.id);
  const url = "http://" + (framework.devHost || "127.0.0.1") + ":" + port + "/";
  const cliPath = path.join(appDir, framework.cli);

  await cleanFramework(framework);
  const devServer = await launchServer(process.execPath, [cliPath, ...framework.devArgs(port)], {
    cwd: appDir,
    url,
  });
  let devWarmSamples;
  try {
    devWarmSamples = await measureRequests(url, options.warmups, options.requests);
  } finally {
    await stopProcess(devServer.child);
  }

  await cleanFramework(framework);
  const build = await runCommand(process.execPath, [cliPath, ...framework.buildArgs()], {
    cwd: appDir,
  });
  await fs.access(path.join(appDir, framework.outputEntry));

  const production = framework.production(port + 10, appDir);
  const productionUrl = "http://127.0.0.1:" + (port + 10) + "/";
  const productionServer = await launchServer(production.command, production.args, {
    cwd: appDir,
    env: production.env,
    url: productionUrl,
  });
  let productionSamples;
  try {
    productionSamples = await measureRequests(productionUrl, options.warmups, options.requests);
  } finally {
    await stopProcess(productionServer.child);
  }

  return {
    devFirstPageMs: devServer.ready.elapsedMs,
    devFirstRequestMs: devServer.ready.firstRequestMs,
    devWarmResponseMs: devWarmSamples,
    buildMs: build.durationMs,
    productionBootMs: productionServer.ready.elapsedMs,
    productionResponseMs: productionSamples,
    responseBytes: productionServer.ready.responseBytes,
  };
}

async function collectBenchmarkInputFiles(directory = benchmarkDir, relativeDirectory = "") {
  const files = [];
  const ignoredDirectories = new Set([
    "node_modules",
    ".farm",
    ".next",
    ".nitro",
    ".nuxt",
    ".output",
    ".svelte-kit",
    ".tanstack",
    "build",
    "results",
  ]);

  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectBenchmarkInputFiles(absolutePath, relativePath)));
      continue;
    }
    if (
      relativePath === ".benchmark.lock" ||
      /^apps\/farm\/src\/farm-.*\.d\.ts$/.test(relativePath) ||
      relativePath === "apps/farm/src/lib/api.generated.ts"
    ) {
      continue;
    }
    files.push({ absolutePath, relativePath });
  }

  return files;
}

async function hashBenchmarkInputs() {
  const hash = createHash("sha256");
  const files = await collectBenchmarkInputFiles();
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  for (const file of files) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(await fs.readFile(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function readCommand(command, args = []) {
  try {
    return execFileSync(command, args, { cwd: repoRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

async function collectRunIdentity() {
  const farmSourceStatus = readCommand("git", [
    "status",
    "--porcelain",
    "--",
    "packages/farm",
    "packages/farm-cli",
  ]);
  const farmSourceDiff = readCommand("git", [
    "diff",
    "HEAD",
    "--binary",
    "--",
    "packages/farm",
    "packages/farm-cli",
  ]);
  const benchmarkInputStatus = readCommand("git", [
    "status",
    "--porcelain",
    "--",
    benchmarkGitPath,
    ":(exclude)" + benchmarkGitPath + "/results/**",
  ]);
  return {
    benchmarkInputsDirty: benchmarkInputStatus !== "",
    commit: readCommand("git", ["rev-parse", "HEAD"]),
    branch: readCommand("git", ["branch", "--show-current"]),
    farmSourceDirty: farmSourceStatus !== "",
    farmSourceDiffSha256: createHash("sha256").update(farmSourceDiff).digest("hex"),
    workspaceDirty: readCommand("git", ["status", "--porcelain"]) !== "",
    rootLockDirty: readCommand("git", ["status", "--porcelain", "--", "pnpm-lock.yaml"]) !== "",
    rootLockSha256: createHash("sha256")
      .update(await fs.readFile(path.join(repoRoot, "pnpm-lock.yaml")))
      .digest("hex"),
    inputSha256: await hashBenchmarkInputs(),
  };
}

function assertRunIdentityUnchanged(start, end) {
  for (const key of [
    "benchmarkInputsDirty",
    "commit",
    "branch",
    "farmSourceDirty",
    "farmSourceDiffSha256",
    "rootLockDirty",
    "rootLockSha256",
    "inputSha256",
  ]) {
    if (start[key] !== end[key]) {
      throw new Error("Benchmark inputs changed during the run (identity field: " + key + ")");
    }
  }
}

function assertPublishableRunIdentity(identity) {
  if (identity.benchmarkInputsDirty || identity.farmSourceDirty || identity.rootLockDirty) {
    throw new Error(
      "Publishing requires clean benchmark inputs, Farm source packages, and root pnpm-lock.yaml",
    );
  }
}

function collectSystemMetadata() {
  const cpus = os.cpus();
  const productName =
    process.platform === "darwin" ? readCommand("sw_vers", ["-productName"]) : os.type();
  const productVersion =
    process.platform === "darwin" ? readCommand("sw_vers", ["-productVersion"]) : os.release();
  return {
    os: productName + " " + productVersion,
    architecture: os.arch(),
    cpu: cpus[0]?.model.trim() || "unknown",
    logicalCpuCount: cpus.length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    node: process.versions.node,
    pnpm: readCommand("corepack", ["pnpm", "--version"]),
  };
}

function detectContendedRounds(rounds) {
  const buildMedians = new Map(
    frameworks.map((framework) => {
      const values = rounds
        .map((round) => round.frameworks[framework.id]?.buildMs)
        .filter(Number.isFinite);
      return [framework.id, summarize(values).median];
    }),
  );

  return rounds
    .filter((round) => {
      const slowFrameworks = Object.entries(round.frameworks).filter(
        ([id, result]) => result.buildMs > buildMedians.get(id) * 1.5,
      );
      return slowFrameworks.length >= 3;
    })
    .map((round) => round.index);
}

function createReport(options, selected, samplesByFramework, rounds, identity) {
  const contendedRounds = detectContendedRounds(rounds);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    revision: {
      benchmarkInputsDirty: identity.benchmarkInputsDirty,
      commit: identity.commit,
      branch: identity.branch,
      farmSourceDirty: identity.farmSourceDirty,
      farmSourceDiffSha256: identity.farmSourceDiffSha256,
      rootLockDirty: identity.rootLockDirty,
      workspaceDirty: identity.workspaceDirty,
    },
    inputs: {
      sha256: identity.inputSha256,
      rootLockSha256: identity.rootLockSha256,
    },
    fixture: {
      name: "small-dynamic-ssr",
      marker,
      description:
        "One dynamic SSR route rendering the same 120-item list and shared CSS in each framework.",
    },
    methodology: {
      runs: options.runs,
      burnInRounds: options.burnIn ? 1 : 0,
      seed: options.seed,
      farmPackagesPrepared: options.prepare,
      measuredRequestsPerRun: options.requests,
      warmupRequestsPerRun: options.warmups,
      order: "Seeded, position-balanced cyclic schedule",
      cache:
        "Generated framework caches removed before dev and build; OS filesystem and any product-enabled Node compile cache warm",
      nodeCompileCache:
        "Ambient Node compile-cache controls removed; framework CLIs retain their normal compile-cache behavior",
      readinessPollIntervalMs,
      timer: "External monotonic wall clock",
      devFirstPage:
        "Framework process spawn to the first HTTP 200 containing the expected rendered marker",
      cleanBuild: "Framework build process spawn to successful exit after generated-cache removal",
      productionBoot:
        "Built production process spawn to the first HTTP 200 containing the expected marker",
      responseLatency:
        "Sequential full-body loopback HTTP requests with a fresh connection; warmups excluded",
      productionCommand:
        "Recommended framework production command; Next.js uses next start and every other row uses a generated server entry",
    },
    quality: {
      contendedRounds,
      contentionRule:
        "Publishing is blocked when at least three frameworks exceed 1.5× their own median build time in the same round",
      publishable: contendedRounds.length === 0,
    },
    system: collectSystemMetadata(),
    rounds,
    frameworks: selected.map((framework) => {
      const samples = samplesByFramework.get(framework.id);
      return {
        id: framework.id,
        label: framework.label,
        version: framework.version,
        stack: framework.stack,
        metrics: {
          devFirstPageMs: summarize(samples.devFirstPageMs),
          devFirstRequestMs: summarize(samples.devFirstRequestMs),
          devWarmResponseMs: summarize(samples.devWarmResponseMs),
          buildMs: summarize(samples.buildMs),
          productionBootMs: summarize(samples.productionBootMs),
          productionResponseMs: summarize(samples.productionResponseMs),
          responseBytes: summarize(samples.responseBytes),
        },
      };
    }),
  };
}

function createPublishedReport(report) {
  return {
    generatedAt: report.generatedAt,
    revision: {
      benchmarkInputsDirty: report.revision.benchmarkInputsDirty,
      commit: report.revision.commit.slice(0, 12),
      farmSourceDirty: report.revision.farmSourceDirty,
      rootLockDirty: report.revision.rootLockDirty,
      workspaceDirty: report.revision.workspaceDirty,
    },
    inputs: report.inputs,
    fixture: report.fixture,
    quality: report.quality,
    methodology: {
      runs: report.methodology.runs,
      burnInRounds: report.methodology.burnInRounds,
      seed: report.methodology.seed,
      farmPackagesPrepared: report.methodology.farmPackagesPrepared,
      measuredRequestsPerRun: report.methodology.measuredRequestsPerRun,
      warmupRequestsPerRun: report.methodology.warmupRequestsPerRun,
      order: report.methodology.order,
      cache: report.methodology.cache,
      nodeCompileCache: report.methodology.nodeCompileCache,
      readinessPollIntervalMs: report.methodology.readinessPollIntervalMs,
    },
    system: report.system,
    frameworks: report.frameworks.map((framework) => ({
      id: framework.id,
      label: framework.label,
      version: framework.version,
      stack: framework.stack,
      metrics: Object.fromEntries(
        Object.entries(framework.metrics).map(([key, value]) => [key, withoutSamples(value)]),
      ),
    })),
  };
}

function createMarkdown(report) {
  const lines = [
    "# Meta-framework benchmark",
    "",
    "Generated " +
      report.generatedAt +
      " at Farm commit " +
      report.revision.commit.slice(0, 12) +
      ".",
    "",
    "| Framework | First dev page | Warm dev | Fixture build | Production boot | Production response p50 / p95 | HTML |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];

  for (const framework of report.frameworks) {
    const metrics = framework.metrics;
    lines.push(
      "| " +
        framework.label +
        " " +
        framework.version +
        " | " +
        formatMs(metrics.devFirstPageMs.median) +
        " | " +
        formatMs(metrics.devWarmResponseMs.median) +
        " | " +
        formatMs(metrics.buildMs.median) +
        " | " +
        formatMs(metrics.productionBootMs.median) +
        " | " +
        formatMs(metrics.productionResponseMs.median) +
        " / " +
        formatMs(metrics.productionResponseMs.p95) +
        " | " +
        Math.round(metrics.responseBytes.median).toLocaleString("en") +
        " B |",
    );
  }

  lines.push(
    "",
    "Lower is better. Values are medians unless a percentile is named.",
    "",
    "## Scope",
    "",
    "- Fixture: " + report.fixture.description,
    "- Build metric: complete fixture-project production build; local Farm package preparation is excluded.",
    "- Warm responses: " +
      report.methodology.warmupRequestsPerRun +
      " equal warm-up requests per server and round are excluded from the samples.",
    "- Runs: " +
      (report.methodology.burnInRounds
        ? report.methodology.burnInRounds + " discarded burn-in plus "
        : "no burn-in; ") +
      report.methodology.runs +
      " measured rounds; order: " +
      report.methodology.order.toLowerCase() +
      ".",
    "- Cache policy: " + report.methodology.cache + ".",
    "- Machine: " +
      report.system.cpu +
      ", " +
      report.system.memoryGb +
      " GB, " +
      report.system.os +
      ".",
    "- Runtime: Node " + report.system.node + ", pnpm " + report.system.pnpm + ".",
    "- Benchmark input SHA-256: " + report.inputs.sha256 + ".",
    "- Benchmark inputs dirty: " + (report.revision.benchmarkInputsDirty ? "yes" : "no") + ".",
    "- Farm source dirty: " + (report.revision.farmSourceDirty ? "yes" : "no") + ".",
    "- Root lockfile dirty: " + (report.revision.rootLockDirty ? "yes" : "no") + ".",
    "- Workspace dirty: " +
      (report.revision.workspaceDirty ? "yes; the broader workspace state is recorded" : "no") +
      ".",
    "- Contended measured rounds detected: " +
      (report.quality.contendedRounds.length ? report.quality.contendedRounds.join(", ") : "none") +
      ".",
    "",
    "See ../README.md for metric boundaries, controls, limitations, and reproduction steps. " +
      "The complete samples are in latest.json.",
    "",
  );
  return lines.join("\n");
}

async function writeReports(report) {
  await fs.mkdir(resultsDir, { recursive: true });
  const published = createPublishedReport(report);
  const generatedModule = [
    "/* This file is generated by benchmarks/frameworks/run.mjs. */",
    "export const frameworkBenchmarkReport = " + JSON.stringify(published, null, 2) + " as const;",
    "",
  ].join("\n");
  const outputs = [
    {
      path: path.join(resultsDir, "latest.json"),
      contents: JSON.stringify(report, null, 2) + "\n",
    },
    { path: path.join(resultsDir, "latest.md"), contents: createMarkdown(report) },
    {
      path: path.join(repoRoot, "docs/src/lib/benchmark-results.generated.ts"),
      contents: generatedModule,
    },
  ];

  try {
    await Promise.all(
      outputs.map((output) => fs.writeFile(output.path + ".tmp-" + process.pid, output.contents)),
    );
    for (const output of outputs) {
      await fs.rename(output.path + ".tmp-" + process.pid, output.path);
    }
    await runCommand("corepack", [
      "pnpm",
      "exec",
      "oxfmt",
      ...outputs.map((output) => output.path),
    ]);
  } finally {
    await Promise.all(
      outputs.map((output) => fs.rm(output.path + ".tmp-" + process.pid, { force: true })),
    );
  }
}

async function main() {
  const arguments_ = process.argv.slice(2);
  if (arguments_.some((argument) => argument === "--help" || argument === "-h")) {
    printHelp();
    return;
  }
  if (arguments_.includes("--self-check")) {
    if (arguments_.length !== 1)
      throw new Error("--self-check cannot be combined with other options");
    runSelfChecks();
    return;
  }
  await acquireBenchmarkLock();
  try {
    await runBenchmark();
  } finally {
    await releaseBenchmarkLock();
  }
}

async function runBenchmark() {
  const options = parseOptions(process.argv.slice(2));
  const selected = frameworks.filter((framework) => options.only.includes(framework.id));
  assertSupportedNode(selected);
  const measuredOrders = createBalancedRoundOrders(selected, options.runs, options.seed);
  assertPositionBalanced(measuredOrders, selected);

  for (const framework of selected) await assertInstalled(framework);
  const startIdentity = await collectRunIdentity();
  if (options.publish) assertPublishableRunIdentity(startIdentity);
  if (options.prepare && selected.some((framework) => framework.id === "farm")) {
    await prepareFarm();
  }

  const samplesByFramework = new Map(
    selected.map((framework) => [
      framework.id,
      {
        devFirstPageMs: [],
        devFirstRequestMs: [],
        devWarmResponseMs: [],
        buildMs: [],
        productionBootMs: [],
        productionResponseMs: [],
        responseBytes: [],
      },
    ]),
  );
  const roundRecords = [];

  if (options.burnIn) {
    const order = shuffled(selected, options.seed - 1);
    console.log("\nBurn-in (discarded): " + order.map((framework) => framework.label).join(" → "));
    for (const framework of order) {
      process.stdout.write("  " + framework.label.padEnd(14) + " ");
      const result = await runRound(framework, -1, options);
      console.log(
        "dev " +
          formatMs(result.devFirstPageMs) +
          " · build " +
          formatMs(result.buildMs) +
          " · boot " +
          formatMs(result.productionBootMs),
      );
    }
  }

  for (let round = 0; round < options.runs; round += 1) {
    const order = measuredOrders[round];
    const roundRecord = {
      index: round + 1,
      order: order.map((framework) => framework.id),
      loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
      frameworks: {},
    };
    console.log(
      "\nRound " +
        (round + 1) +
        "/" +
        options.runs +
        ": " +
        order.map((framework) => framework.label).join(" → "),
    );

    for (const framework of order) {
      process.stdout.write("  " + framework.label.padEnd(14) + " ");
      const result = await runRound(framework, round, options);
      const samples = samplesByFramework.get(framework.id);
      samples.devFirstPageMs.push(result.devFirstPageMs);
      samples.devFirstRequestMs.push(result.devFirstRequestMs);
      samples.devWarmResponseMs.push(...result.devWarmResponseMs);
      samples.buildMs.push(result.buildMs);
      samples.productionBootMs.push(result.productionBootMs);
      samples.productionResponseMs.push(...result.productionResponseMs);
      samples.responseBytes.push(result.responseBytes);
      roundRecord.frameworks[framework.id] = {
        devFirstPageMs: Math.round(result.devFirstPageMs * 100) / 100,
        devWarmResponseMs: summarize(result.devWarmResponseMs).median,
        buildMs: Math.round(result.buildMs * 100) / 100,
        productionBootMs: Math.round(result.productionBootMs * 100) / 100,
        productionResponseMs: summarize(result.productionResponseMs).median,
        responseBytes: result.responseBytes,
      };
      console.log(
        "dev " +
          formatMs(result.devFirstPageMs) +
          " · build " +
          formatMs(result.buildMs) +
          " · boot " +
          formatMs(result.productionBootMs),
      );
    }
    roundRecords.push(roundRecord);
  }

  const endIdentity = await collectRunIdentity();
  assertRunIdentityUnchanged(startIdentity, endIdentity);
  const report = createReport(options, selected, samplesByFramework, roundRecords, startIdentity);
  console.log("\n" + createMarkdown(report));

  if (options.publish) {
    if (!report.quality.publishable) {
      throw new Error(
        "Refusing to publish: correlated host contention detected in measured round(s) " +
          report.quality.contendedRounds.join(", "),
      );
    }
    await writeReports(report);
    console.log("Raw samples: " + path.relative(repoRoot, path.join(resultsDir, "latest.json")));
  } else {
    console.log("Canonical result files unchanged. Pass --publish for a qualifying full run.");
  }
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (error) => {
  await stopActiveChildren();
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
