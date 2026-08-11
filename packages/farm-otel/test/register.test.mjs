import assert from "node:assert/strict";
import test from "node:test";
import { trace } from "@opentelemetry/api";
import { registerOTel } from "../dist/index.js";

test("registerOTel starts, exports, flushes, and shuts down a real SDK", async () => {
  const spans = [];
  let shutDown = false;
  const exporter = {
    export(batch, callback) {
      spans.push(...batch);
      callback({ code: 0 });
    },
    async shutdown() {
      shutDown = true;
    },
  };

  const controller = await registerOTel({
    serviceName: "farm-otel-test",
    autoInstrumentations: false,
    traceExporter: exporter,
  });
  const span = trace.getTracer("farm-otel-test").startSpan("test span");
  span.end();
  await controller.forceFlush();

  assert.equal(spans.length, 1);
  assert.equal(spans[0].name, "test span");
  assert.equal(spans[0].resource.attributes["service.name"], "farm-otel-test");
  await controller.shutdown();
  assert.equal(shutDown, true);
});
