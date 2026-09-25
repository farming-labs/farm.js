import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import test from "node:test";
import {
  configureFarmObservability,
  emitFarmEvent,
  resetFarmObservability,
} from "@farm.js/core/observability";
import { ROOT_CONTEXT, context, trace } from "@opentelemetry/api";
import { BasicTracerProvider } from "@opentelemetry/sdk-trace-base";
import { recordFarmEvents } from "../dist/index.js";

// Only bounded values belong on a metric. `key` embeds the serialized arguments
// of the cached call and tags are authored at runtime, so both must stay on span
// events; this list is what the mapping is allowed to put on an instrument.
const ALLOWED_METRIC_ATTRIBUTES = new Set([
  "farm.cache.result",
  "farm.cache.stale",
  "farm.cache.operation",
  "farm.ppr.result",
  "farm.http.status_class",
  // The middleware matcher, which comes from configuration rather than the URL.
  "farm.route",
]);

class TestContextManager {
  #storage = new AsyncLocalStorage();

  active() {
    return this.#storage.getStore() ?? ROOT_CONTEXT;
  }

  with(activeContext, fn, thisArg, ...args) {
    return this.#storage.run(activeContext, () => fn.apply(thisArg, args));
  }

  bind(_activeContext, target) {
    return target;
  }

  enable() {
    return this;
  }

  disable() {
    return this;
  }
}

context.setGlobalContextManager(new TestContextManager());

function createMeterProviderStub({ failing = false } = {}) {
  const stub = {
    scopes: [],
    instruments: [],
    recorded: [],
    getMeter(scope) {
      stub.scopes.push(scope);
      const create = (kind) => (name) => {
        stub.instruments.push({ kind, name });
        const write = (value, attributes) => {
          if (failing) throw new Error("meter exploded");
          stub.recorded.push({ name, kind, value, attributes });
        };
        return { add: write, record: write };
      };
      return {
        createCounter: create("counter"),
        createHistogram: create("histogram"),
        createUpDownCounter: create("updowncounter"),
      };
    },
    entries(name) {
      return stub.recorded.filter((entry) => entry.name === name);
    },
    only(name) {
      const entries = stub.entries(name);
      assert.equal(entries.length, 1, `expected one ${name} record, got ${entries.length}`);
      return entries[0];
    },
  };
  return stub;
}

function startSpan() {
  const provider = new BasicTracerProvider();
  return provider.getTracer("farm-otel-test").startSpan("GET /blog/[slug]");
}

function eventNames(span) {
  return span.events.map((event) => event.name);
}

function findEvent(span, name) {
  const found = span.events.filter((event) => event.name === name);
  assert.equal(found.length, 1, `expected one ${name} span event, got ${found.length}`);
  return found[0];
}

async function withSubscription(options, run) {
  const meterProvider = options.meterProvider ?? createMeterProviderStub();
  const dispose = await recordFarmEvents({ ...options, meterProvider });
  try {
    await run(meterProvider, dispose);
  } finally {
    dispose();
    resetFarmObservability();
  }
}

test("cache lookups become a bounded counter and a detailed span event", async () => {
  await withSubscription({}, async (meter) => {
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({
        type: "cache.hit",
        key: 'getUser["ada@example.com"]',
        route: "/account",
        tags: ["user-42", "account"],
        revalidate: 60,
        stale: true,
      });
    });
    span.end();

    const lookup = meter.only("farm.cache.lookups");
    assert.equal(lookup.kind, "counter");
    assert.equal(lookup.value, 1);
    assert.deepEqual(lookup.attributes, {
      "farm.cache.result": "hit",
      "farm.cache.stale": true,
    });

    const recorded = findEvent(span, "cache.hit");
    assert.equal(recorded.attributes["farm.cache.result"], "hit");
    assert.deepEqual(recorded.attributes["farm.tags"], ["user-42", "account"]);
    assert.equal(recorded.attributes["farm.route"], "/account");
    assert.equal(recorded.attributes["farm.revalidate"], 60);
    assert.equal(recorded.attributes["farm.key"], undefined);
  });
});

test("cache invalidations count operations and the entries they removed", async () => {
  await withSubscription({}, async (meter) => {
    emitFarmEvent({ type: "cache.revalidateTag", tag: "user-42", count: 7 });

    assert.deepEqual(meter.only("farm.cache.invalidations").attributes, {
      "farm.cache.operation": "revalidateTag",
    });
    const entries = meter.only("farm.cache.invalidated_entries");
    assert.equal(entries.value, 7);
    assert.deepEqual(entries.attributes, { "farm.cache.operation": "revalidateTag" });
  });
});

test("ppr shell outcomes become a counter without the shell key", async () => {
  await withSubscription({}, async (meter) => {
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({ type: "ppr.shell.hit", route: "/blog/hello", key: "/blog/hello::en" });
      emitFarmEvent({ type: "ppr.shell.bypass", route: "/blog/hello", reason: "cookie" });
    });
    span.end();

    const [hit, bypass] = meter.entries("farm.ppr.shell.lookups");
    assert.deepEqual(hit.attributes, { "farm.ppr.result": "hit" });
    assert.deepEqual(bypass.attributes, { "farm.ppr.result": "bypass" });
    assert.deepEqual(eventNames(span), ["ppr.shell.hit", "ppr.shell.bypass"]);
    assert.equal(findEvent(span, "ppr.shell.bypass").attributes["farm.reason"], "cookie");
  });
});

test("streaming shell readiness and ppr refresh durations become histograms", async () => {
  await withSubscription({}, async (meter) => {
    emitFarmEvent({ type: "render.stream.shellReady", route: "/blog/hello", durationMs: 42 });
    emitFarmEvent({ type: "ppr.refresh.complete", route: "/blog/hello", durationMs: 130 });

    const shell = meter.only("farm.render.stream.shell.duration");
    assert.equal(shell.kind, "histogram");
    assert.equal(shell.value, 42);
    // The bus reports a request pathname here, not a route pattern, so no route
    // reaches the histogram.
    assert.equal(shell.attributes, undefined);

    const refresh = meter.only("farm.ppr.refresh.duration");
    assert.equal(refresh.kind, "histogram");
    assert.equal(refresh.value, 130);
  });
});

test("middleware short circuits carry the matcher and a status class", async () => {
  await withSubscription({}, async (meter) => {
    emitFarmEvent({
      type: "middleware.shortCircuit",
      route: "/dashboard/:path*",
      pathname: "/dashboard/settings",
      name: "src/app/dashboard/middleware.ts",
      status: 302,
    });

    assert.deepEqual(meter.only("farm.middleware.short_circuits").attributes, {
      "farm.route": "/dashboard/:path*",
      "farm.http.status_class": "3xx",
    });
  });
});

test("no metric attribute carries a cache key, a tag or a request path", async () => {
  await withSubscription({}, async (meter) => {
    const secrets = ['getUser["ada@example.com"]', "user-42", "/blog/hello"];
    emitFarmEvent({
      type: "cache.hit",
      key: secrets[0],
      tags: [secrets[1]],
      route: secrets[2],
      stale: true,
    });
    emitFarmEvent({ type: "cache.miss", key: secrets[0], route: secrets[2], reason: "stale" });
    emitFarmEvent({ type: "cache.stale", key: secrets[0], tags: [secrets[1]] });
    emitFarmEvent({ type: "cache.dedupe", key: secrets[0] });
    emitFarmEvent({ type: "cache.bypass", key: secrets[0], route: secrets[2], reason: "cookie" });
    emitFarmEvent({ type: "cache.updateTag", tag: secrets[1], count: 2 });
    emitFarmEvent({ type: "cache.revalidatePath", path: secrets[2], count: 3 });
    emitFarmEvent({ type: "cache.invalidated", key: secrets[0], tag: secrets[1], count: 1 });
    emitFarmEvent({ type: "ppr.shell.miss", route: secrets[2], key: secrets[0] });
    emitFarmEvent({ type: "ppr.shell.cached", route: secrets[2], key: secrets[0], revalidate: 60 });
    emitFarmEvent({ type: "render.stream.shellReady", route: secrets[2], durationMs: 7 });
    emitFarmEvent({ type: "ppr.refresh.complete", route: secrets[2], durationMs: 9 });

    assert.ok(meter.recorded.length >= 12);
    for (const entry of meter.recorded) {
      const attributes = entry.attributes ?? {};
      for (const name of Object.keys(attributes)) {
        assert.ok(
          ALLOWED_METRIC_ATTRIBUTES.has(name),
          `${entry.name} recorded an unbounded attribute: ${name}`,
        );
      }
      const serialized = JSON.stringify(attributes);
      for (const secret of secrets) {
        assert.ok(!serialized.includes(secret), `${entry.name} leaked ${secret}: ${serialized}`);
      }
    }
  });
});

test("instruments are created once per subscription", async () => {
  await withSubscription({}, async (meter) => {
    for (let index = 0; index < 5; index++) {
      emitFarmEvent({ type: "cache.hit", key: `key-${index}` });
      emitFarmEvent({ type: "render.stream.shellReady", route: "/", durationMs: index });
    }

    assert.deepEqual(meter.scopes, ["@farm.js/otel"]);
    const names = meter.instruments.map((instrument) => instrument.name);
    assert.deepEqual(names, [...new Set(names)]);
    assert.equal(meter.entries("farm.cache.lookups").length, 5);
  });
});

test("dispose removes the subscription", async () => {
  const meterProvider = createMeterProviderStub();
  const dispose = await recordFarmEvents({ meterProvider });
  emitFarmEvent({ type: "cache.hit", key: "a" });
  dispose();
  emitFarmEvent({ type: "cache.hit", key: "b" });
  resetFarmObservability();

  assert.equal(meterProvider.entries("farm.cache.lookups").length, 1);
});

test("a failing instrument warns once and never throws into the emitter", async () => {
  const meterProvider = createMeterProviderStub({ failing: true });
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await withSubscription({ meterProvider }, async () => {
      const event = emitFarmEvent({ type: "cache.hit", key: "a" });
      assert.equal(event.type, "cache.hit");
      emitFarmEvent({ type: "cache.hit", key: "b" });
    });
  } finally {
    console.warn = warn;
  }

  // Once, not per event: these families are emitted on hot paths.
  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /\[farm:otel\] failed to record farm events: meter exploded/);
});

test("span events can be turned off independently of metrics", async () => {
  await withSubscription({ spanEvents: false }, async (meter) => {
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({ type: "cache.hit", key: "a" });
    });
    span.end();

    assert.equal(meter.entries("farm.cache.lookups").length, 1);
    assert.deepEqual(eventNames(span), []);
  });
});

test("metrics can be turned off independently of span events", async () => {
  await withSubscription({ metrics: false }, async (meter) => {
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({ type: "cache.hit", key: "a" });
    });
    span.end();

    assert.deepEqual(meter.scopes, []);
    assert.deepEqual(meter.recorded, []);
    assert.deepEqual(eventNames(span), ["cache.hit"]);
  });
});

test("a meter provider that cannot create instruments still starts", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  let dispose;
  try {
    dispose = await recordFarmEvents({
      meterProvider: {
        getMeter() {
          throw new Error("no meter for you");
        },
      },
    });
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({ type: "cache.hit", key: "a" });
    });
    span.end();

    // Metrics are gone, span events still work.
    assert.deepEqual(eventNames(span), ["cache.hit"]);
  } finally {
    console.warn = warn;
    dispose?.();
    resetFarmObservability();
  }

  assert.equal(warnings.length, 1, warnings.join("\n"));
  assert.match(warnings[0], /failed to create farm metrics/);
});

test("narrowing observability.events does not silence the mapping", async () => {
  await withSubscription({}, async (meter) => {
    // `events` narrows delivery to application handlers and logs. Instruments
    // are not a log drain, so they keep recording.
    configureFarmObservability({ events: ["request.complete"] });
    emitFarmEvent({ type: "cache.hit", key: "a" });

    assert.equal(meter.entries("farm.cache.lookups").length, 1);
  });
});

test("the span event is not duplicated when farm tracing already recorded it", async () => {
  await withSubscription({}, async (meter) => {
    configureFarmObservability({ tracing: true });
    const span = startSpan();
    context.with(trace.setSpan(ROOT_CONTEXT, span), () => {
      emitFarmEvent({ type: "cache.hit", key: "a", route: "/account" });
    });
    span.end();

    assert.deepEqual(eventNames(span), ["cache.hit"]);
    assert.equal(meter.entries("farm.cache.lookups").length, 1);
  });
});
