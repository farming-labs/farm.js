import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { inspect } from "node:util";

// Exercise the actual orchestration without starting a framework or relying on
// a connection race. Keep transport/fixture validation covered by their suites.
const source = readFileSync(new URL("./run.mjs", import.meta.url), "utf8");
function load(startMarker, endMarker, name, dependencies) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start > 0 && end > start);
  return new Function(
    ...Object.keys(dependencies),
    source.slice(start, end) + "; return " + name + ";",
  )(...Object.values(dependencies));
}

const connectionError = () =>
  new AggregateError(
    [
      Object.assign(new Error("IPv6 connection reset"), {
        code: "ECONNRESET",
        address: "::1",
        port: 46104,
      }),
      Object.assign(new Error("IPv4 connection refused"), {
        code: "ECONNREFUSED",
        address: "127.0.0.1",
        port: 46104,
      }),
    ],
    "Connection failed",
  );

test("startup failure retains the URL, server output, nested cause and cleanup", async () => {
  const child = {},
    failure = connectionError(),
    stopped = [];
  const launch = load(
    "async function launchServer(",
    "async function cleanFramework(",
    "launchServer",
    {
      URL,
      performance,
      assertPortAvailable: async () => {},
      spawnProcess: () => ({ child, output: { value: "server startup detail" } }),
      waitForRenderedPage: async () => {
        throw failure;
      },
      stopProcess: async (value) => stopped.push(value),
    },
  );
  await assert.rejects(launch("node", [], { url: "http://localhost:46104/" }), (error) => {
    assert.match(error.message, /http:\/\/localhost:46104\//);
    assert.match(error.message, /server startup detail/);
    assert.equal(error.cause, failure);
    return true;
  });
  assert.deepEqual(stopped, [child]);
});

for (const failureAt of [
  "dev startup",
  "dev requests",
  "production build",
  "production startup",
  "production requests",
]) {
  for (const round of [-1, 2]) {
    test(`${failureAt} failure identifies framework and ${round < 0 ? "burn-in" : "round"}`, async () => {
      const failure = connectionError(),
        stopped = [];
      let starts = 0,
        requests = 0;
      const framework = {
        id: "farm",
        label: "Farm.js",
        directory: "farm",
        cli: "cli.mjs",
        devArgs: () => [],
        buildArgs: () => [],
        outputEntry: "server.mjs",
        production: () => ({ command: "node", args: [] }),
      };
      const run = load(
        "async function runRound(",
        "async function collectBenchmarkInputFiles(",
        "runRound",
        {
          path,
          appsRoot: "/fixtures",
          basePort: 46100,
          frameworks: [framework],
          process,
          cleanFramework: async () => {},
          launchServer: async () => {
            const mode = starts++ === 0 ? "dev" : "production";
            if (failureAt === mode + " startup") throw failure;
            return {
              child: mode,
              output: { value: mode + " server detail" },
              ready: { elapsedMs: 1 },
            };
          },
          measureRequests: async () => {
            const mode = requests++ === 0 ? "dev" : "production";
            if (failureAt === mode + " requests") throw failure;
            return [1];
          },
          stopProcess: async (child) => stopped.push(child),
          runCommand: async () => {
            if (failureAt === "production build") throw failure;
            return { durationMs: 1 };
          },
          fs: { access: async () => {} },
        },
      );
      await assert.rejects(
        run(framework, round, { encoding: "identity", warmups: 1, requests: 1 }),
        (error) => {
          assert.match(error.message, /Farm\.js/);
          assert.ok(error.message.includes(round < 0 ? "burn-in" : "round 3"));
          assert.ok(error.message.includes(failureAt));
          const rendered = inspect(error, { depth: null, customInspect: false });
          assert.match(rendered, /ECONNRESET/);
          assert.match(rendered, /ECONNREFUSED/);
          if (failureAt.endsWith("requests")) {
            assert.match(rendered, /server detail/);
            assert.match(rendered, /http:\/\//);
          }
          return true;
        },
      );
      if (failureAt !== "dev startup") assert.ok(stopped.includes("dev"));
      if (failureAt === "production requests") assert.ok(stopped.includes("production"));
    });
  }
}

for (const cleanupFails of [false, true]) {
  test(`top-level logging retains nested errors (cleanup failure=${cleanupFails})`, async () => {
    const marker = "main().catch(async (error) => {";
    const start = source.indexOf(marker);
    assert.ok(start > 0);
    const callback = source
      .slice(start + "main().catch(".length)
      .trim()
      .replace(/\);$/, "");
    const logged = [],
      state = {};
    let stopped = 0;
    const report = new Function(
      "stopActiveChildren",
      "console",
      "process",
      "inspect",
      "return " + callback,
    )(
      async () => {
        stopped++;
        if (cleanupFails) throw new Error("cannot stop child process");
      },
      { error: (...values) => logged.push(values) },
      state,
      inspect,
    );
    const error = new Error("Farm.js round 3 failed", {
      cause: new Error("Server startup failed", { cause: connectionError() }),
    });
    await report(error);
    assert.equal(stopped, 1);
    assert.equal(state.exitCode, 1);
    assert.match(logged[0][0], /Farm\.js round 3/);
    assert.match(logged[0][0], /Server startup failed/);
    assert.match(logged[0][0], /ECONNRESET/);
    assert.match(logged[0][0], /ECONNREFUSED/);
    assert.match(logged[0][0], /46104/);
    assert.equal(logged.length, cleanupFails ? 2 : 1);
    if (cleanupFails) {
      assert.equal(logged[1][0], "Benchmark process cleanup failed:");
      assert.match(logged[1][1], /cannot stop child process/);
    }
  });
}

for (const aggregate of [false, true]) {
  test(`readiness still retries only refused connections (aggregate=${aggregate})`, async () => {
    const refusal = Object.assign(new Error("not listening"), { code: "ECONNREFUSED" });
    const refused = aggregate ? new AggregateError([refusal]) : refusal;
    for (const error of [
      refused,
      connectionError(),
      Object.assign(new Error("deadline"), { name: "TimeoutError" }),
      new Error("invalid encoding"),
    ]) {
      let calls = 0;
      const wait = load(
        "async function waitForRenderedPage(",
        "async function launchServer(",
        "waitForRenderedPage",
        {
          performance,
          hasExited: () => false,
          readinessPollIntervalMs: 2,
          requestPage: async () => {
            if (++calls === 1) throw error;
            return { completedAt: 1 };
          },
          isFreshFixtureResponse: () => true,
          setTimeout,
        },
      );
      const task = wait({}, { value: "" }, "http://localhost/", 0, { onResponse: () => {} });
      if (error === refused) {
        await task;
        assert.equal(calls, 2);
      } else {
        await assert.rejects(task, (value) => value === error);
        assert.equal(calls, 1);
      }
    }
  });
}
