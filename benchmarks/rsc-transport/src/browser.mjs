import React, { useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createFromReadableStream } from "react-server-dom-webpack/client.browser";

const decoder = new TextDecoder();
const flightTarget = document.querySelector("#flight-target");
const contentTarget = document.querySelector("#content-target");
const flightRoot = createRoot(flightTarget);
const sectionCounts = {
  small: 6,
  medium: 24,
  large: 96,
};
const modes = ["html", "js", "wasm", "flight-html", "flight"];

let javascriptRendererPromise;
let wasmRendererPromise;
let expectedShellToken;

function StatefulFlightShell({ model }) {
  const token = useRef(`shell-${Math.random().toString(36).slice(2)}`).current;
  expectedShellToken ??= token;
  return React.createElement("section", { "data-shell-token": token }, model);
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function activate(mode) {
  const flight = mode.startsWith("flight");
  flightTarget.classList.toggle("benchmark-hidden", !flight);
  contentTarget.classList.toggle("benchmark-hidden", flight);
}

async function loadJavascriptRenderer() {
  if (!javascriptRendererPromise) {
    const rendererUrl = "/assets/renderer.js";
    javascriptRendererPromise = import(/* @vite-ignore */ rendererUrl);
  }
  return javascriptRendererPromise;
}

async function loadWasmRenderer() {
  if (!wasmRendererPromise) {
    wasmRendererPromise = (async () => {
      const response = await fetch("/assets/renderer.wasm", { cache: "no-store" });
      if (!response.ok) throw new Error(`Wasm renderer request failed: ${response.status}`);

      const { instance } = await WebAssembly.instantiateStreaming(response);
      const exports = instance.exports;
      const required = ["memory", "alloc", "dealloc", "render", "output_length"];
      for (const name of required) {
        if (!(name in exports)) throw new Error(`Wasm renderer is missing export ${name}`);
      }

      return {
        render(input) {
          const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
          const inputPointer = exports.alloc(bytes.byteLength);
          new Uint8Array(exports.memory.buffer, inputPointer, bytes.byteLength).set(bytes);
          const outputPointer = exports.render(inputPointer, bytes.byteLength);
          const outputLength = exports.output_length();
          exports.dealloc(inputPointer, bytes.byteLength);
          if (!outputPointer || !outputLength) throw new Error("Rust/Wasm renderer failed");

          const html = decoder.decode(
            new Uint8Array(exports.memory.buffer, outputPointer, outputLength),
          );
          exports.dealloc(outputPointer, outputLength);
          return html;
        },
      };
    })();
  }
  return wasmRendererPromise;
}

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarizeMetric(samples, key) {
  const values = samples.map((sample) => sample[key]).filter(Number.isFinite);
  return {
    min: Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(...values),
  };
}

function summarize(samples) {
  return {
    samples,
    headersMs: summarizeMetric(samples, "headersMs"),
    bodyMs: summarizeMetric(samples, "bodyMs"),
    transformMs: summarizeMetric(samples, "transformMs"),
    commitMs: summarizeMetric(samples, "commitMs"),
    totalMs: summarizeMetric(samples, "totalMs"),
    serverMs: summarizeMetric(samples, "serverMs"),
    responseBytes: samples[0].responseBytes,
  };
}

function validate(mode, size) {
  const target = mode.startsWith("flight") ? flightTarget : contentTarget;
  if (mode.startsWith("flight")) {
    const shell = target.querySelector("[data-shell-token]");
    if (shell?.dataset.shellToken !== expectedShellToken) {
      throw new Error(`${mode}/${size}: surrounding client shell state was replaced`);
    }
  }
  const article = target.querySelector('.benchmark-article[data-fixture="transport-v1"]');
  if (!article) throw new Error(`${mode}/${size}: missing rendered benchmark article`);

  const headings = article.querySelectorAll("h1, h2, h3").length;
  if (headings !== sectionCounts[size] + 1) {
    throw new Error(
      `${mode}/${size}: expected ${sectionCounts[size] + 1} headings, received ${headings}`,
    );
  }
}

async function performNavigation(mode, size, variant) {
  activate(mode);
  const endpointMode = mode === "js" || mode === "wasm" ? "ir" : mode;
  const start = performance.now();
  const response = await fetch(`/api/${endpointMode}/${size}?variant=${variant}`, {
    cache: "no-store",
  });
  const headersAt = performance.now();
  if (!response.ok || !response.body) {
    throw new Error(`${mode}/${size}: payload request failed with ${response.status}`);
  }

  let bodyAt = headersAt;
  let transformAt = headersAt;
  let model;
  let html;

  if (mode.startsWith("flight")) {
    model = await createFromReadableStream(response.body);
    transformAt = performance.now();
    bodyAt = transformAt;
  } else if (mode === "html") {
    html = await response.text();
    bodyAt = performance.now();
    transformAt = bodyAt;
  } else {
    const input = await response.arrayBuffer();
    bodyAt = performance.now();
    if (mode === "js") {
      html = (await loadJavascriptRenderer()).renderIr(input);
    } else {
      html = (await loadWasmRenderer()).render(input);
    }
    transformAt = performance.now();
  }

  const commitStart = performance.now();
  if (mode.startsWith("flight")) {
    flushSync(() => {
      flightRoot.render(React.createElement(StatefulFlightShell, { model }));
    });
  } else {
    contentTarget.innerHTML = html;
  }
  const committedAt = performance.now();

  return {
    headersMs: headersAt - start,
    bodyMs: bodyAt - headersAt,
    transformMs: mode.startsWith("flight") ? transformAt - headersAt : transformAt - bodyAt,
    commitMs: committedAt - commitStart,
    totalMs: committedAt - start,
    serverMs: Number(response.headers.get("x-produce-duration-ms") || 0),
    responseBytes: Number(response.headers.get("content-length") || 0),
  };
}

async function measureColdLoad(loader) {
  const start = performance.now();
  await loader();
  return performance.now() - start;
}

export async function runTransportBenchmark(options = {}) {
  const selectedSizes = options.sizes ?? ["small", "medium", "large"];
  const runs = options.runs ?? 20;
  const warmups = options.warmups ?? 4;

  const coldLoads = {
    jsRendererMs: await measureColdLoad(loadJavascriptRenderer),
    wasmRendererMs: await measureColdLoad(loadWasmRenderer),
  };
  const sizes = {};

  for (const size of selectedSizes) {
    const samples = Object.fromEntries(modes.map((mode) => [mode, []]));

    for (const mode of modes) {
      for (let warmup = 0; warmup < warmups; warmup += 1) {
        await performNavigation(mode, size, warmup % 6);
      }
      validate(mode, size);
      await nextFrame();
    }

    for (let round = 0; round < runs; round += 1) {
      const offset = round % modes.length;
      const order = [...modes.slice(offset), ...modes.slice(0, offset)];
      for (const mode of order) {
        const sample = await performNavigation(mode, size, (round + 1) % 6);
        validate(mode, size);
        samples[mode].push(sample);
        await nextFrame();
      }
    }

    sizes[size] = Object.fromEntries(modes.map((mode) => [mode, summarize(samples[mode])]));
  }

  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runs,
    warmups,
    surroundingClientStatePreserved: Boolean(expectedShellToken),
    coldLoads,
    sizes,
  };

  const saveResponse = await fetch("/api/browser-results", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result, null, 2),
  });
  if (!saveResponse.ok) {
    throw new Error(`Could not save browser results: ${saveResponse.status}`);
  }

  return result;
}

window.runTransportBenchmark = runTransportBenchmark;
window.transportBenchmarkReady = true;

const runButton = document.querySelector('[data-testid="run-benchmark"]');
const statusOutput = document.querySelector('[data-testid="benchmark-status"]');

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  statusOutput.value = "Running 50 measured navigations per mode…";
  try {
    const result = await runTransportBenchmark({ runs: 50, warmups: 8 });
    statusOutput.value = `Complete: ${result.runs} runs per mode`;
  } catch (error) {
    console.error(error);
    statusOutput.value = `Failed: ${error.message}`;
  } finally {
    runButton.disabled = false;
  }
});
