import assert from "node:assert/strict";
import test from "node:test";
import { metrics } from "@opentelemetry/api";
import { registerOTel, shutdownOTel } from "../dist/index.js";

// Keeps the Node SDK from registering its own meter provider over the stub, so
// the mapping and the flush both resolve to the provider this file controls.
process.env.OTEL_METRICS_EXPORTER = "none";

function createMeterProviderStub(forceFlush) {
  const noop = { add() {}, record() {} };
  return {
    scopes: [],
    getMeter(scope) {
      this.scopes.push(scope);
      return { createCounter: () => noop, createHistogram: () => noop };
    },
    forceFlush,
  };
}

function createTraceExporterStub() {
  return {
    export(_batch, callback) {
      callback({ code: 0 });
    },
    async shutdown() {},
  };
}

test("forceFlush flushes the meter provider the mapping records into", async () => {
  let flushes = 0;
  const meterProvider = createMeterProviderStub(async () => {
    flushes += 1;
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const controller = await registerOTel({
    serviceName: "farm-otel-flush-test",
    autoInstrumentations: false,
    traceExporter: createTraceExporterStub(),
  });
  try {
    // Serverless freezes the process between requests, so a recorded metric only
    // leaves on an explicit flush.
    await controller.forceFlush();

    assert.deepEqual(meterProvider.scopes, ["@farm.js/otel"]);
    assert.equal(flushes, 1);
  } finally {
    await shutdownOTel();
  }
});

test("a failing metric flush does not fail the flush it was part of", async () => {
  metrics.disable();
  metrics.setGlobalMeterProvider(
    createMeterProviderStub(async () => {
      throw new Error("collector unreachable");
    }),
  );

  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  const controller = await registerOTel({
    serviceName: "farm-otel-flush-failure-test",
    autoInstrumentations: false,
    traceExporter: createTraceExporterStub(),
  });
  try {
    await controller.forceFlush();
  } finally {
    console.warn = warn;
    await shutdownOTel();
  }

  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /\[farm:otel\] metric flush failed: collector unreachable/);
});
