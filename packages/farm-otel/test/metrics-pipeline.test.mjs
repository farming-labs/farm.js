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

test("a configured OTLP endpoint registers a real meter provider", async () => {
  // The spec already defaults OTEL_METRICS_EXPORTER to `otlp`, so the ordinary
  // production posture is an endpoint with the exporter variable left alone.
  // Treating that as "no metrics wanted" silenced every metric, including the
  // auto-instrumentation http metrics that exported before farm read this.
  delete process.env.OTEL_METRICS_EXPORTER;
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318";

  await registerOTel({
    serviceName: "farm-otel-metrics-endpoint-test",
    autoInstrumentations: false,
    traceExporter: createTraceExporterStub(),
  });
  try {
    const provider = metrics.getMeterProvider();
    // A real MeterProvider hands out a distinct meter per instrumentation scope
    // and exposes a flush; the API no-op provider does neither.
    assert.notEqual(provider.getMeter("one"), provider.getMeter("two"));
    assert.equal(typeof provider.forceFlush, "function");
  } finally {
    await shutdownOTel();
    // A registered global meter provider outlives shutdown, and the API refuses
    // to replace one, so a later test in this process would keep seeing it.
    metrics.disable();
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }
});

test("OTEL_METRICS_EXPORTER=none still turns metrics off", async () => {
  // The SDK's own off switch has to keep working, since it is what the fix
  // documents for an app that has a collector configured but wants no metrics.
  process.env.OTEL_METRICS_EXPORTER = "none";
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = "http://127.0.0.1:4318";

  await registerOTel({
    serviceName: "farm-otel-metrics-none-test",
    autoInstrumentations: false,
    traceExporter: createTraceExporterStub(),
  });
  try {
    const provider = metrics.getMeterProvider();
    assert.equal(provider.forceFlush, undefined);
  } finally {
    await shutdownOTel();
    delete process.env.OTEL_METRICS_EXPORTER;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  }
});
