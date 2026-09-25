import assert from "node:assert/strict";
import test from "node:test";
import { metrics } from "@opentelemetry/api";
import { registerOTel, shutdownOTel } from "../dist/index.js";

function createTraceExporterStub() {
  return {
    export(_batch, callback) {
      callback({ code: 0 });
    },
    async shutdown() {},
  };
}

test("no metrics pipeline is registered unless the app asks for one", async () => {
  delete process.env.OTEL_METRICS_EXPORTER;

  await registerOTel({
    serviceName: "farm-otel-metrics-pipeline-test",
    autoInstrumentations: false,
    traceExporter: createTraceExporterStub(),
  });
  try {
    const provider = metrics.getMeterProvider();
    // The API's no-op provider hands out one shared meter and has no flush. A
    // real MeterProvider would return a distinct meter per instrumentation scope.
    assert.equal(provider.getMeter("one"), provider.getMeter("two"));
    assert.equal(provider.forceFlush, undefined);
  } finally {
    await shutdownOTel();
  }
});
