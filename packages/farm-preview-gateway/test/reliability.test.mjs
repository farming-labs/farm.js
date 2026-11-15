import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  createPreviewGatewayHandler,
  MemoryPreviewGatewayStore,
  RedisRestPreviewGatewayStore,
} from "../dist/index.js";

const ORIGIN = "http://localhost:3000";

function createHandler(store, options = {}) {
  return createPreviewGatewayHandler({
    store,
    domain: "preview.farmjs.dev",
    requestTimeoutMs: 2000,
    pollTimeoutMs: 1000,
    pollIntervalMs: 10,
    ...options,
  });
}

async function createSession(handler, name) {
  const response = await handler(
    new Request(`${ORIGIN}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, localUrl: "http://localhost:4321" }),
    }),
  );
  assert.equal(response.status, 200);
  return await response.json();
}

function poll(handler, session, signal) {
  return handler(
    new Request(
      `${ORIGIN}/api/sessions/${session.id}/requests?token=${session.token}&wait=1000`,
      signal ? { signal } : {},
    ),
  );
}

function queuedRequest(id) {
  return { id, method: "GET", path: `/${id}`, headers: {}, createdAt: Date.now() };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("returns requests taken by a poll whose client already went away", async () => {
  const entered = deferred();
  const release = deferred();
  let holdNextTake = false;
  const store = new (class extends MemoryPreviewGatewayStore {
    async takeRequests(sessionId, limit) {
      if (holdNextTake) {
        holdNextTake = false;
        entered.resolve();
        await release.promise;
      }
      return await super.takeRequests(sessionId, limit);
    }
  })();
  const handler = createHandler(store);
  const session = await createSession(handler, "orphaned-poll");
  await store.enqueueRequest(session.id, queuedRequest("req_first"), 60_000);
  await store.enqueueRequest(session.id, queuedRequest("req_second"), 60_000);

  const controller = new AbortController();
  holdNextTake = true;
  const orphaned = poll(handler, session, controller.signal);
  await entered.promise;
  // The client disconnects while the take is in flight; the take still
  // removes both requests from the queue.
  controller.abort();
  release.resolve();
  const orphanedResponse = await orphaned;
  assert.notEqual(orphanedResponse.status, 200);

  const next = await poll(handler, session);
  assert.equal(next.status, 200);
  const { requests } = await next.json();
  assert.deepEqual(
    requests.map((request) => request.id),
    ["req_first", "req_second"],
  );
});

test("stops an abandoned poll before it takes requests or reports a heartbeat", async () => {
  const connected = [];
  const firstTake = deferred();
  const store = new (class extends MemoryPreviewGatewayStore {
    async takeRequests(sessionId, limit) {
      const requests = await super.takeRequests(sessionId, limit);
      firstTake.resolve();
      return requests;
    }
  })();
  const handler = createHandler(store, {
    observer: { session: (event) => connected.push(event.state) },
  });
  const session = await createSession(handler, "abandoned-poll");

  const controller = new AbortController();
  const abandoned = poll(handler, session, controller.signal);
  await firstTake.promise;
  controller.abort();
  const heartbeatsBeforeAbort = connected.length;
  await store.enqueueRequest(session.id, queuedRequest("req_waiting"), 60_000);

  const response = await abandoned;
  assert.notEqual(response.status, 200);
  assert.equal(connected.length, heartbeatsBeforeAbort);

  const next = await poll(handler, session);
  assert.equal(next.status, 200);
  const { requests } = await next.json();
  assert.deepEqual(
    requests.map((request) => request.id),
    ["req_waiting"],
  );
});

test("lets only one of two concurrent creates claim a preview name", async () => {
  const bothRead = deferred();
  let reads = 0;
  const store = new (class extends MemoryPreviewGatewayStore {
    async getSessionByName(name) {
      const session = await super.getSessionByName(name);
      if (++reads === 2) bothRead.resolve();
      await bothRead.promise;
      return session;
    }
  })();
  const handler = createHandler(store);
  const create = () =>
    handler(
      new Request(`${ORIGIN}/api/sessions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "contested", localUrl: "http://localhost:4321" }),
      }),
    );

  const responses = await Promise.all([create(), create()]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [200, 409]);

  const winner = await responses.find((response) => response.status === 200).json();
  const owner = await store.getSessionByName("contested");
  assert.equal(owner.id, winner.id);
});

test("claims Redis preview names atomically and still takes over stale owners", async () => {
  const redis = await createFakeRedisRest();
  try {
    const store = new RedisRestPreviewGatewayStore({ url: redis.url, token: "test-token" });
    const handler = createHandler(store, { clientHeartbeatTimeoutMs: 50 });

    redis.gateNameReads(2);
    const create = () =>
      handler(
        new Request(`${ORIGIN}/api/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "redis-contested", localUrl: "http://localhost:4321" }),
        }),
      );
    const responses = await Promise.all([create(), create()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const winner = await responses.find((response) => response.status === 200).json();
    assert.equal((await store.getSessionByName("redis-contested")).id, winner.id);
    // The losing create leaves no session record behind.
    assert.equal(redis.keys("farm-preview:session:").length, 1);

    // A session that stopped heartbeating can still be replaced.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const takeover = await createSession(handler, "redis-contested");
    assert.notEqual(takeover.id, winner.id);
    assert.equal((await store.getSessionByName("redis-contested")).id, takeover.id);
  } finally {
    await redis.close();
  }
});

test("hides unexpected error details from callers", async () => {
  const store = new (class extends MemoryPreviewGatewayStore {
    async getSessionById() {
      throw new Error("Preview gateway Redis command failed (500): internal secret detail");
    }
  })();
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args);
  try {
    const handler = createHandler(store);
    const response = await handler(new Request(`${ORIGIN}/api/sessions/sess_x/requests?token=tok`));
    assert.equal(response.status, 500);
    const body = await response.text();
    assert.equal(body, "Unexpected preview gateway error.");
    assert.doesNotMatch(body, /secret/);
    assert.equal(logged.length, 1);
  } finally {
    console.error = originalError;
  }
});

// A minimal Upstash-compatible REST endpoint backed by a Map. EVAL only
// understands the gateway's name-claim script.
async function createFakeRedisRest() {
  const values = new Map();
  let nameReadGate;

  const run = async ([command, ...args]) => {
    switch (command) {
      case "GET": {
        const value = values.get(args[0]) ?? null;
        if (nameReadGate && args[0].includes(":name:")) {
          const gate = nameReadGate;
          if (++gate.count === gate.expected) {
            nameReadGate = undefined;
            gate.resolve();
          }
          await gate.promise;
        }
        return value;
      }
      case "SET": {
        const flags = args.slice(2).map((flag) => String(flag).toUpperCase());
        const exists = values.has(args[0]);
        if (flags.includes("NX") && exists) return null;
        if (flags.includes("XX") && !exists) return null;
        values.set(args[0], args[1]);
        return "OK";
      }
      case "DEL":
        return args.filter((key) => values.delete(key)).length;
      case "EXISTS":
        return args.filter((key) => values.has(key)).length;
      case "EXPIRE":
        return values.has(args[0]) ? 1 : 0;
      case "RPUSH":
      case "LPUSH": {
        const list = values.get(args[0]) ?? [];
        for (const value of args.slice(1)) {
          if (command === "RPUSH") list.push(value);
          else list.unshift(value);
        }
        values.set(args[0], list);
        return list.length;
      }
      case "LPOP": {
        const list = values.get(args[0]);
        if (!list?.length) return null;
        return list.splice(0, Number(args[1] ?? 1));
      }
      case "EVAL": {
        const [, , key, replaceable, id] = args;
        const owner = values.get(key);
        if (owner === undefined || owner === id || (replaceable !== "" && owner === replaceable)) {
          values.set(key, id);
          return 1;
        }
        return 0;
      }
      default:
        throw new Error(`Unsupported fake Redis command ${command}`);
    }
  };

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      const result = await run(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ result }));
    } catch (error) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: String(error.message) }));
    }
  });
  await new Promise((resolve) => server.listen(0, resolve));

  return {
    url: `http://localhost:${server.address().port}`,
    keys: (prefix) => [...values.keys()].filter((key) => key.startsWith(prefix)),
    gateNameReads(expected) {
      nameReadGate = { expected, count: 0, ...deferred() };
    },
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}
