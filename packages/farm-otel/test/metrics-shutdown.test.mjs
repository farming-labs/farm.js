import assert from "node:assert/strict";
import test from "node:test";
import { emitFarmEvent, resetFarmObservability } from "@farm.js/core/observability";
import { registerOTel } from "../dist/index.js";

// Its own file so it runs in its own process: the metrics API accepts one global
// meter provider per process, so a sibling test that registers one would decide
// this outcome instead of the SDK configuration under test.
test("recording farm events does not stall shutdown without a collector", async () => {
  delete process.env.OTEL_METRICS_EXPORTER;

  const controller = await registerOTel({
    serviceName: "farm-otel-metrics-shutdown-test",
    autoInstrumentations: false,
    traceExporter: {
      export(_batch, callback) {
        callback({ code: 0 });
      },
      async shutdown() {},
    },
  });
  emitFarmEvent({ type: "cache.hit", key: "a" });
  emitFarmEvent({ type: "render.stream.shellReady", route: "/", durationMs: 12 });

  const startedAt = Date.now();
  await controller.shutdown();
  resetFarmObservability();
  const elapsed = Date.now() - startedAt;

  // With the SDK's implicit OTLP metrics pipeline this took ~8.2s, the exporter
  // retrying against a localhost endpoint with nothing behind it. Farm's
  // production lifecycle waits on instrumentation shutdown, so that is a stalled
  // deploy rather than a slow test.
  assert.ok(elapsed < 4000, `shutdown took ${elapsed}ms`);
});
