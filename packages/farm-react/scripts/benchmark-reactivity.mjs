import { performance } from "node:perf_hooks";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";
import { createCompiledComponent } from "../dist/compiler-runtime.mjs";

const bindingCount = Number(process.env.FARM_REACTIVITY_BINDINGS || 2_048);
const warmupSamples = Number(process.env.FARM_REACTIVITY_WARMUP || 10);
const measuredSamples = Number(process.env.FARM_REACTIVITY_SAMPLES || 40);
const updatesPerSample = Number(process.env.FARM_REACTIVITY_UPDATES || 5);

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});

for (const name of [
  "Element",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "MutationObserver",
  "Node",
]) {
  globalThis[name] = dom.window[name];
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function summarize(samples) {
  return {
    medianMs: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    meanMs: samples.reduce((total, value) => total + value, 0) / samples.length,
  };
}

function flushCompilerUpdate() {
  return new Promise((resolve) => queueMicrotask(resolve));
}

async function measure(run) {
  for (let sample = 0; sample < warmupSamples; sample += 1) {
    for (let update = 0; update < updatesPerSample; update += 1) await run();
  }
  const samples = [];
  for (let sample = 0; sample < measuredSamples; sample += 1) {
    const startedAt = performance.now();
    for (let update = 0; update < updatesPerSample; update += 1) await run();
    samples.push((performance.now() - startedAt) / updatesPerSample);
  }
  return summarize(samples);
}

function mountBranchFanout(reactivity) {
  let cells;
  let reads = 0;
  const bindings = Array.from({ length: bindingCount }, (_, index) => ({
    kind: "text",
    tracking: "dynamic",
    path: [index],
    target: index,
    dependencies: [0, 1, 2],
    read(_props, state) {
      reads += 1;
      return state[0].get() ? state[1].get() : state[2].get();
    },
  }));
  const Fanout = createCompiledComponent({
    displayName: `BranchFanout${reactivity}`,
    reactivity,
    initialize: () => [true, 0, 0],
    render(_props, state, blocks) {
      cells = state;
      return React.createElement(
        "div",
        null,
        ...bindings.map((binding, index) =>
          React.createElement(
            "span",
            { key: index, ref: blocks.target(binding.target) },
            state[0].get() ? state[1].get() : state[2].get(),
          ),
        ),
      );
    },
    bindings,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Fanout)));
  return {
    cells,
    readCount: () => reads,
    resetReads: () => {
      reads = 0;
    },
    unmount: () => {
      flushSync(() => root.unmount());
      container.remove();
    },
  };
}

async function measureBranchAction(reactivity, cellIndex) {
  const fixture = mountBranchFanout(reactivity);
  try {
    fixture.resetReads();
    const timing = await measure(async () => {
      fixture.cells[cellIndex].set((value) => Number(value) + 1);
      await flushCompilerUpdate();
    });
    return { ...timing, bindingReads: fixture.readCount() };
  } finally {
    fixture.unmount();
  }
}

async function measureIndexedScheduling(reactivity) {
  let cells;
  let reads = 0;
  const bindings = Array.from({ length: bindingCount }, (_, index) => ({
    kind: "text",
    path: [index],
    target: index,
    dependencies: [index],
    read(_props, state) {
      reads += 1;
      return state[index].get();
    },
  }));
  const Indexed = createCompiledComponent({
    displayName: `Indexed${reactivity}`,
    reactivity,
    initialize: () => Array.from({ length: bindingCount }, () => 0),
    render(_props, state, blocks) {
      cells = state;
      return React.createElement(
        "div",
        null,
        ...bindings.map((binding, index) =>
          React.createElement(
            "span",
            { key: index, ref: blocks.target(binding.target) },
            state[index].get(),
          ),
        ),
      );
    },
    bindings,
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  flushSync(() => root.render(React.createElement(Indexed)));
  reads = 0;
  let updateIndex = 0;
  try {
    const timing = await measure(async () => {
      updateIndex = (updateIndex + 7919) % bindingCount;
      cells[updateIndex].set((value) => Number(value) + 1);
      await flushCompilerUpdate();
    });
    return { ...timing, bindingReads: reads };
  } finally {
    flushSync(() => root.unmount());
    container.remove();
  }
}

const staticCold = await measureBranchAction("static", 2);
const hybridCold = await measureBranchAction("hybrid", 2);
const staticActive = await measureBranchAction("static", 1);
const hybridActive = await measureBranchAction("hybrid", 1);
const staticIndexed = await measureIndexedScheduling("static");
const hybridIndexed = await measureIndexedScheduling("hybrid");

const totalMeasuredUpdates = measuredSamples * updatesPerSample;
const report = {
  workload: {
    bindingCount,
    measuredSamples,
    totalMeasuredUpdates,
    updatesPerSample,
    warmupSamples,
  },
  inactiveBranch: {
    static: staticCold,
    hybrid: hybridCold,
    speedup: staticCold.medianMs / hybridCold.medianMs,
  },
  activeFanout: {
    static: staticActive,
    hybrid: hybridActive,
    speedup: staticActive.medianMs / hybridActive.medianMs,
  },
  indexedSingleBinding: {
    static: staticIndexed,
    hybrid: hybridIndexed,
  },
};

console.log(JSON.stringify(report, null, 2));

if (hybridCold.bindingReads !== 0) {
  throw new Error(`Hybrid inactive-branch updates performed ${hybridCold.bindingReads} reads.`);
}
if (
  staticCold.bindingReads !==
  bindingCount * (warmupSamples + measuredSamples) * updatesPerSample
) {
  throw new Error("Static inactive-branch updates did not evaluate every declared binding.");
}
if (staticIndexed.bindingReads !== (warmupSamples + measuredSamples) * updatesPerSample) {
  throw new Error("Static dependency indexing evaluated unrelated bindings.");
}
if (hybridIndexed.bindingReads !== (warmupSamples + measuredSamples) * updatesPerSample) {
  throw new Error("Hybrid dependency indexing evaluated unrelated bindings.");
}
