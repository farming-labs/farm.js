import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import {
  createPersistentPreviewRelay,
  startTypeScriptPreviewAgent,
} from "../../packages/farm-preview-tunnel/dist/index.js";

const require = createRequire(import.meta.url);
const defaultRustPackage = fileURLToPath(new URL("../../../tunnel", import.meta.url));
const rustPackage = process.env.FARM_PREVIEW_RUST_PACKAGE || defaultRustPackage;
const { activePreviewAgentCount, startPreviewAgent, stopPreviewAgent, waitPreviewAgent } = require(
  rustPackage,
);

const warmupRequests = readPositiveInteger("FARM_PREVIEW_BENCH_WARMUP", 25);
const sequentialRequests = readPositiveInteger("FARM_PREVIEW_BENCH_SEQUENTIAL", 150);
const concurrentRequests = readPositiveInteger("FARM_PREVIEW_BENCH_CONCURRENT", 500);
const concurrency = readPositiveInteger("FARM_PREVIEW_BENCH_CONCURRENCY", 25);
const payload = Buffer.alloc(readPositiveInteger("FARM_PREVIEW_BENCH_PAYLOAD", 4096), "f");

const target = createServer(async (request, response) => {
  if (request.url?.startsWith("/echo")) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    response.statusCode = 202;
    response.setHeader("content-type", "application/octet-stream");
    response.setHeader("x-preview-target", "farm-benchmark");
    response.end(Buffer.concat(chunks));
    return;
  }

  response.statusCode = 200;
  response.setHeader("content-type", "application/octet-stream");
  response.setHeader("x-preview-target", "farm-benchmark");
  response.end(payload);
});

await listen(target);
const targetAddress = target.address();
const targetUrl = `http://127.0.0.1:${targetAddress.port}`;
const relay = createPersistentPreviewRelay({ requestTimeoutMs: 10_000 });
const relayAddress = await relay.listen();
reportStage(`Target ${targetUrl} and relay ${relayAddress.websocketUrl} are ready.`);

const results = [];
let typescriptAgent;
let rustSession;
let targetClosed = false;

try {
  await verifyEndpoint(targetUrl);
  reportStage("Direct target correctness verified.");
  results.push(await benchmarkEndpoint("Direct localhost", targetUrl));

  typescriptAgent = await startTypeScriptPreviewAgent({
    relayUrl: relayAddress.websocketUrl,
    name: "benchmark-typescript",
    targetUrl,
  });
  reportStage(`TypeScript agent registered at ${typescriptAgent.publicUrl}.`);
  await verifyEndpoint(typescriptAgent.publicUrl);
  results.push(await benchmarkEndpoint("TypeScript persistent agent", typescriptAgent.publicUrl));
  await typescriptAgent.close();
  typescriptAgent = undefined;
  await expectInactive(`${relayAddress.httpUrl}/preview/benchmark-typescript`);
  reportStage("TypeScript forwarding and shutdown verified.");

  rustSession = await startPreviewAgent(relayAddress.websocketUrl, "benchmark-rust", targetUrl);
  reportStage(`Rust agent registered at ${rustSession.publicUrl}.`);
  assert.equal(activePreviewAgentCount(), 1);
  await verifyEndpoint(rustSession.publicUrl);
  results.push(await benchmarkEndpoint("Rust N-API persistent agent", rustSession.publicUrl));
  reportStage("Rust forwarding verified; stopping the local target.");
  await close(target);
  targetClosed = true;
  await expectInactive(`${relayAddress.httpUrl}/preview/benchmark-rust`, 4_000);
  assert.equal(await waitPreviewAgent(rustSession.sessionId), true);
  rustSession = undefined;
  assert.equal(activePreviewAgentCount(), 0);
  reportStage("Rust automatic shutdown verified.");

  printResults(results);
} finally {
  if (typescriptAgent) await typescriptAgent.close();
  if (rustSession) await stopPreviewAgent(rustSession.sessionId);
  await relay.close();
  if (!targetClosed) await close(target);
}

async function verifyEndpoint(baseUrl) {
  const body = Buffer.from("farm-preview-correctness");
  const response = await fetch(`${baseUrl}/echo?mode=verify`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body,
  });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get("x-preview-target"), "farm-benchmark");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
}

async function expectInactive(url, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = await fetch(url);
    if (response.status === 404) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Preview route remained active after its agent stopped: ${url}`);
}

async function benchmarkEndpoint(name, baseUrl) {
  for (let index = 0; index < warmupRequests; index += 1) {
    await checkedFetch(`${baseUrl}/payload?warmup=${index}`);
  }

  const sequential = [];
  const sequentialStarted = performance.now();
  for (let index = 0; index < sequentialRequests; index += 1) {
    const started = performance.now();
    await checkedFetch(`${baseUrl}/payload?sequential=${index}`);
    sequential.push(performance.now() - started);
  }
  const sequentialElapsed = performance.now() - sequentialStarted;

  const concurrent = [];
  const concurrentStarted = performance.now();
  let nextRequest = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = nextRequest;
        nextRequest += 1;
        if (index >= concurrentRequests) return;
        const started = performance.now();
        await checkedFetch(`${baseUrl}/payload?concurrent=${index}`);
        concurrent.push(performance.now() - started);
      }
    }),
  );
  const concurrentElapsed = performance.now() - concurrentStarted;

  return {
    name,
    sequential: summarize(sequential, sequentialElapsed),
    concurrent: summarize(concurrent, concurrentElapsed),
  };
}

async function checkedFetch(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-preview-target"), "farm-benchmark");
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, payload.length);
}

function summarize(samples, elapsedMs) {
  const sorted = samples.toSorted((left, right) => left - right);
  return {
    requests: samples.length,
    meanMs: average(samples),
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    requestsPerSecond: samples.length / (elapsedMs / 1000),
  };
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

function printResults(values) {
  const rows = values.flatMap((result) => [
    toRow(result.name, "sequential", result.sequential),
    toRow(result.name, `concurrent x${concurrency}`, result.concurrent),
  ]);
  console.table(rows);
  console.log(
    JSON.stringify(
      {
        environment: {
          node: process.version,
          platform: `${process.platform}-${process.arch}`,
          payloadBytes: payload.length,
          warmupRequests,
          sequentialRequests,
          concurrentRequests,
          concurrency,
        },
        results: values,
      },
      null,
      2,
    ),
  );
}

function toRow(agent, mode, value) {
  return {
    agent,
    mode,
    requests: value.requests,
    "mean ms": value.meanMs.toFixed(2),
    "p50 ms": value.p50Ms.toFixed(2),
    "p95 ms": value.p95Ms.toFixed(2),
    "p99 ms": value.p99Ms.toFixed(2),
    "req/s": value.requestsPerSecond.toFixed(1),
  };
}

function readPositiveInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function reportStage(message) {
  console.error(`[preview-benchmark] ${message}`);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function close(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections?.();
  });
}
