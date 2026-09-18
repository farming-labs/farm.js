// @vitest-environment node

import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { parseSync, types as t } from "@babel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const filename = fileURLToPath(
  new URL("../../../../examples/react-compiler-dashboard/scripts/benchmark.mjs", import.meta.url),
);
const source = readFileSync(filename, "utf8");
const ast = parseSync(source, { filename, configFile: false, babelrc: false });

// Execute the actual runner function with controlled resources, without launching
// the benchmark's top-level builds/trials or copying its cleanup implementation.
function runnerFunction(name: string, globals: Record<string, unknown>) {
  const node = ast?.program.body.find(
    (entry) => t.isFunctionDeclaration(entry) && entry.id?.name === name,
  );
  if (node?.start == null || node.end == null) throw new Error(`Missing runner function: ${name}`);
  return runInNewContext(`(${source.slice(node.start, node.end)})`, globals, { filename }) as (
    ...args: unknown[]
  ) => Promise<unknown>;
}

type Stage =
  | "build"
  | "inspect"
  | "context"
  | "page"
  | "events"
  | "ready"
  | "navigation"
  | "measurement"
  | "screenshot"
  | "close"
  | "stop";
const children: { child: ChildProcess; exited: Promise<unknown> }[] = [];

afterEach(async () => {
  for (const { child, exited } of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await exited;
  }
});

function createHarness(failures: Stage[] = [], realServer = false) {
  const events: string[] = [];
  const errors = new Map(failures.map((stage) => [stage, new Error(`${stage} failed`)]));
  function stage(name: Stage) {
    events.push(name);
    if (errors.has(name)) throw errors.get(name);
  }
  let serverReady: Promise<unknown> | undefined;
  let server = Object.assign(new EventEmitter(), {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  const startServer = vi.fn(() => {
    if (realServer) {
      const child = spawn(
        process.execPath,
        ["-e", 'process.stdout.write("ready\\n"); setInterval(() => {}, 1000);'],
        {
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      const exited = once(child, "exit");
      children.push({ child, exited });
      serverReady = Promise.race([
        once(child.stdout!, "data"),
        exited.then(() => {
          throw new Error("Test server exited before browser setup");
        }),
      ]);
      server = child;
    }
    return server;
  });
  const metrics = new Proxy(
    { executionsAdded: 0 },
    {
      get: (_target, key) => (key === "executionsAdded" ? 0 : [1]),
    },
  );
  const page = {
    on: vi.fn(() => stage("events")),
    goto: vi.fn(async () => stage("navigation")),
    waitForTimeout: vi.fn(async () => undefined),
    locator: vi.fn(() => ({
      locator: (selector: string) => ({
        count: async () => (selector === "[data-bar]" ? 48 : 100),
      }),
    })),
    evaluate: vi.fn(async () => {
      stage("measurement");
      return {
        correctness: {
          activeBarStayedStableDuringInactiveUpdates: true,
          dashboardLive: "true",
          finalMarkedCount: 0,
          finalQueueCount: 0,
          finalTableRows: 0,
          scalePeakRows: 21_000,
        },
        dashboard: metrics,
        table: metrics,
        scale: metrics,
      };
    }),
    screenshot: vi.fn(async () => stage("screenshot")),
  };
  const context = {
    newPage: vi.fn(async () => {
      stage("page");
      return page;
    }),
    close: vi.fn(async () => stage("close")),
  };
  const browser = {
    newContext: vi.fn(async () => {
      await serverReady;
      stage("context");
      return context;
    }),
  };
  const actualStop = runnerFunction("stopServer", { once, setTimeout, clearTimeout });
  const stopServer = vi.fn(async (child) => {
    stage("stop");
    if (realServer) await actualStop(child);
  });
  const measure = runnerFunction("measureTrial", {
    assert,
    path,
    process: { execPath: process.execPath, env: {}, stdout: { write: vi.fn() } },
    rm: vi.fn(async () => undefined),
    runCommand: vi.fn(async () => stage("build")),
    inspectBuild: vi.fn(async () => {
      stage("inspect");
      return { testBuild: true };
    }),
    spawn: startServer,
    serverEntry: "unused-test-entry.mjs",
    waitForServer: vi.fn(async () => stage("ready")),
    stopServer,
    timingSummary: (values: number[]) => ({ samples: values.length }),
    dashboardSamples: 60,
    dashboardUpdatesPerSample: 10,
    tableSamples: 10,
    warmupSamples: 5,
    scaleCycles: 3,
  });
  return {
    browser,
    context,
    page,
    errors,
    events,
    stopServer,
    startServer,
    run: () => measure(browser, "static", "static", 4381),
  };
}

describe("compiler dashboard trial cleanup", () => {
  it.each<Stage>(["build", "inspect"])(
    "does not acquire or dispose trial resources when %s fails",
    async (failure) => {
      const harness = createHarness([failure]);
      await expect(harness.run()).rejects.toBe(harness.errors.get(failure));
      expect(harness.startServer).not.toHaveBeenCalled();
      expect(harness.browser.newContext).not.toHaveBeenCalled();
      expect(harness.context.close).not.toHaveBeenCalled();
      expect(harness.stopServer).not.toHaveBeenCalled();
    },
  );

  it.each<Stage>([
    "context",
    "page",
    "events",
    "ready",
    "navigation",
    "measurement",
    "screenshot",
    "close",
  ])("stops the server when %s fails without continuing the trial", async (failure) => {
    const harness = createHarness([failure]);
    await expect(harness.run()).rejects.toBe(harness.errors.get(failure));
    expect(harness.stopServer).toHaveBeenCalledExactlyOnceWith(
      harness.startServer.mock.results[0].value,
    );
    expect(harness.context.close).toHaveBeenCalledTimes(failure === "context" ? 0 : 1);
    expect(harness.events.at(-1)).toBe("stop");
    if (["context", "page", "events", "ready", "navigation"].includes(failure)) {
      expect(harness.page.evaluate).not.toHaveBeenCalled();
    }
  });

  it("attempts server cleanup even when a failed measurement is followed by failed context disposal", async () => {
    const harness = createHarness(["measurement", "close"]);
    // Preserve ordinary finally semantics: disposal failure still rejects the trial.
    await expect(harness.run()).rejects.toBe(harness.errors.get("close"));
    expect(harness.events.slice(-3)).toEqual(["measurement", "close", "stop"]);
  });

  it("propagates server cleanup failures rather than returning a successful result", async () => {
    const harness = createHarness(["stop"]);
    await expect(harness.run()).rejects.toBe(harness.errors.get("stop"));
    expect(harness.context.close).toHaveBeenCalledOnce();
  });

  it("preserves successful context settings, measurements and teardown order", async () => {
    const harness = createHarness();
    await expect(harness.run()).resolves.toMatchObject({
      compilerMode: "static",
      trial: "static",
      build: { testBuild: true },
    });
    expect(harness.browser.newContext).toHaveBeenCalledExactlyOnceWith({
      reducedMotion: "reduce",
      viewport: { width: 1440, height: 1000 },
    });
    expect(harness.page.goto).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:4381", {
      waitUntil: "networkidle",
    });
    expect(harness.page.waitForTimeout).toHaveBeenCalledExactlyOnceWith(300);
    expect(harness.page.evaluate).toHaveBeenCalledOnce();
    expect(harness.events.slice(-4)).toEqual(["measurement", "screenshot", "close", "stop"]);
  });

  it.each<Stage>(["context", "page", "close"])(
    "reaps a real child process after %s failure",
    async (failure) => {
      const harness = createHarness([failure], true);
      await expect(harness.run()).rejects.toBe(harness.errors.get(failure));
      expect(children).toHaveLength(1);
      const child = children[0].child;
      expect(child.pid).toBeDefined();
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      expect(harness.stopServer).toHaveBeenCalledExactlyOnceWith(child);
    },
  );
});

describe("compiler dashboard server shutdown", () => {
  function stop(server: unknown) {
    return runnerFunction("stopServer", { once, setTimeout, clearTimeout })(server);
  }

  describe("exit and signal ordering", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function createServer() {
      const server = Object.assign(new EventEmitter(), {
        exitCode: null as number | null,
        signalCode: null as NodeJS.Signals | null,
        kill: vi.fn((_signal: string) => true),
      });
      return {
        server,
        exit(code: number | null, signal: NodeJS.Signals | null) {
          server.exitCode = code;
          server.signalCode = signal;
          server.emit("exit", code, signal);
        },
      };
    }

    function expectClean(server: EventEmitter) {
      expect(server.listenerCount("exit")).toBe(0);
      expect(server.listenerCount("error")).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    }

    it.each([
      [0, null],
      [null, "SIGTERM"],
    ] as const)("does not signal an already-exited server (%s, %s)", async (code, signal) => {
      const { server, exit } = createServer();
      exit(code, signal);
      const stopping = stop(server);
      await vi.advanceTimersByTimeAsync(2_000);
      await stopping;
      expect(server.kill).not.toHaveBeenCalled();
      expectClean(server);
    });

    it.each([
      [0, null],
      [null, "SIGTERM"],
    ] as const)("waits for graceful exit (%s, %s) and cancels escalation", async (code, signal) => {
      const { server, exit } = createServer();
      let settled = false;
      const stopping = stop(server).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(settled).toBe(false);
      expect(server.kill.mock.calls).toEqual([["SIGTERM"]]);
      exit(code, signal);
      await stopping;
      expectClean(server);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(server.kill.mock.calls).toEqual([["SIGTERM"]]);
    });

    it("waits for the exit event after sending SIGKILL", async () => {
      const { server, exit } = createServer();
      let settled = false;
      const stopping = stop(server).then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1_999);
      expect(server.kill.mock.calls).toEqual([["SIGTERM"]]);
      await vi.advanceTimersByTimeAsync(1);
      expect(server.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(settled).toBe(false);
      exit(null, "SIGKILL");
      await stopping;
      expectClean(server);
    });

    it("installs the exit listener before signaling", async () => {
      const { server, exit } = createServer();
      server.kill.mockImplementation(() => {
        exit(null, "SIGTERM");
        return true;
      });
      const stopping = stop(server);
      await vi.advanceTimersByTimeAsync(2_000);
      await stopping;
      expect(server.kill.mock.calls).toEqual([["SIGTERM"]]);
      expectClean(server);
    });

    it.each(["SIGTERM", "SIGKILL"])(
      "rejects a %s delivery error and removes owned listeners",
      async (signal) => {
        const { server } = createServer();
        const error = new Error("Cannot signal server");
        const observer = vi.fn();
        server.on("error", observer);
        server.kill.mockImplementation((sent) => {
          if (sent === signal) server.emit("error", error);
          return sent !== signal;
        });
        const rejected = expect(stop(server)).rejects.toBe(error);
        await Promise.all([rejected, vi.advanceTimersByTimeAsync(2_000)]);
        expect(observer).toHaveBeenCalledExactlyOnceWith(error);
        expect(server.listeners("error")).toEqual([observer]);
        server.off("error", observer);
        expectClean(server);
      },
    );

    it.each(["SIGTERM", "SIGKILL"])("rejects when %s throws", async (signal) => {
      const { server } = createServer();
      const error = new Error("Unsupported signal");
      server.kill.mockImplementation((sent) => {
        if (sent === signal) throw error;
        return true;
      });
      const rejected = expect(stop(server)).rejects.toBe(error);
      await Promise.all([rejected, vi.advanceTimersByTimeAsync(2_000)]);
      expectClean(server);
    });

    it.each(["SIGTERM", "SIGKILL"])(
      "does not report success when %s is not delivered",
      async (signal) => {
        const { server } = createServer();
        server.kill.mockImplementation((sent) => sent !== signal);
        const rejected = expect(stop(server)).rejects.toThrow(
          `Could not send ${signal} to benchmark server`,
        );
        await Promise.all([rejected, vi.advanceTimersByTimeAsync(2_000)]);
        expectClean(server);
      },
    );
  });

  it("confirms a real stubborn child has exited before returning", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.on("SIGTERM", () => {}); process.stdout.write("ready\\n"); setInterval(() => {}, 1000);',
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const exited = once(child, "exit");
    children.push({ child, exited });
    await Promise.race([
      once(child.stdout!, "data"),
      exited.then(() => {
        throw new Error("Test child exited before readiness");
      }),
    ]);
    const signal = vi.spyOn(child, "kill");
    try {
      await stop(child);
      expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
      // Windows terminates SIGTERM recipients immediately; POSIX can ignore it.
      expect(signal.mock.calls).toEqual(
        process.platform === "win32" ? [["SIGTERM"]] : [["SIGTERM"], ["SIGKILL"]],
      );
    } finally {
      signal.mockRestore();
    }
  });
});
