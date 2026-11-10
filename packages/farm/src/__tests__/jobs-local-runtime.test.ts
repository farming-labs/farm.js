// @vitest-environment node
import { createStorage } from "unstorage";
import memoryDriver from "unstorage/drivers/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defineTasks,
  jobs,
  local,
  task,
  type LocalJobsRuntimeOptions,
} from "../../../farm-integrations/src/jobs/index";
import { createJobsRuntimeConformance } from "../../../farm-jobs/dist/testing.js";
import { FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY } from "../integrations";

type JobsTestRoute = {
  path: string;
  method: string;
  handler(request: Request, context: unknown): Promise<Response>;
};

const serverContext = {
  req: {
    get: (key: string) =>
      key === FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY ? true : undefined,
  },
};

function memory() {
  return createStorage({ driver: memoryDriver() });
}

/** Deterministic defaults: no poller, no retry wait. Each test drives runs with the tick route. */
function testRuntime(options: LocalJobsRuntimeOptions = {}) {
  return local({ storage: memory(), pollIntervalMs: false, retryDelayMs: 0, ...options });
}

function harness<TTasks extends Parameters<typeof jobs>[0]["tasks"]>(
  tasks: TTasks,
  options: LocalJobsRuntimeOptions = {},
) {
  const integration = jobs({ runtime: testRuntime(options), tasks });
  const routes = integration.routes as unknown as JobsTestRoute[];
  const send = async (method: string, path: string, body?: unknown, headers?: HeadersInit) => {
    const url = new URL(path, "http://farm.test");
    const route = routes.find((entry) => entry.method === method && entry.path === url.pathname);
    if (!route) throw new Error(`No route for ${method} ${url.pathname}`);
    const response = await route.handler(
      new Request(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      serverContext,
    );
    return { status: response.status, body: (await response.json()) as any };
  };
  return {
    integration,
    send,
    trigger: (taskPath: string, body: unknown) =>
      send("POST", `/api/jobs/${taskPath}/trigger`, body),
    status: (taskPath: string, handleId: string) =>
      send("GET", `/api/jobs/${taskPath}/status?handleId=${handleId}`),
    tick: (headers?: HeadersInit) =>
      send("GET", "/api/jobs/_runtime/local/tick", undefined, headers),
  };
}

describe("local() jobs runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("conformance suite", () => {
    for (const conformance of createJobsRuntimeConformance({
      runtime: () => testRuntime(),
      async drive(suite) {
        const result = await suite.runtimeRoute("GET", "tick");
        if (result.status !== 200) throw new Error(`tick answered ${result.status}`);
      },
    })) {
      it(conformance.name, conformance.run);
    }
  });

  it("calls run with the input, run id, and attempt, and stores the output", async () => {
    const seen: unknown[] = [];
    const jobsHarness = harness(
      defineTasks({
        sendWelcomeEmail: task({
          async run(input: { userId: string }, context) {
            seen.push(input, context.runtime, context.task, context.run);
            return { messageId: `msg_${input.userId}` };
          },
        }),
      }),
    );
    const queued = await jobsHarness.trigger("send-welcome-email", { userId: "usr_1" });
    expect(queued.status).toBe(200);
    expect(queued.body).toMatchObject({ task: "sendWelcomeEmail", runtime: "local" });
    expect(queued.body.handleId).toMatch(/^run_[a-f0-9]{32}$/);

    expect((await jobsHarness.status("send-welcome-email", queued.body.handleId)).body.status).toBe(
      "queued",
    );
    expect((await jobsHarness.tick()).body).toMatchObject({ started: 1, completed: 1 });

    const status = await jobsHarness.status("send-welcome-email", queued.body.handleId);
    expect(status.body).toMatchObject({
      status: "completed",
      output: { messageId: "msg_usr_1" },
      error: null,
      runtime: "local",
      raw: { attempt: 1, maxAttempts: 3, nextAttemptAt: null },
    });
    expect(seen).toEqual([
      { userId: "usr_1" },
      "local",
      { key: "sendWelcomeEmail", id: "send-welcome-email" },
      { id: queued.body.handleId, attempt: 1 },
    ]);
  });

  it("retries a failing run up to defaults.retry.attempts and keeps the last error", async () => {
    let calls = 0;
    const jobsHarness = harness(
      defineTasks({
        flaky: task({
          defaults: { retry: { attempts: 3 } },
          async run() {
            calls += 1;
            if (calls < 3) throw new Error(`attempt ${calls} failed`);
            return { calls };
          },
        }),
      }),
    );
    const { body } = await jobsHarness.trigger("flaky", {});
    expect((await jobsHarness.tick()).body).toMatchObject({ started: 1, retried: 1 });
    const retrying = await jobsHarness.status("flaky", body.handleId);
    expect(retrying.body.status).toBe("queued");
    expect(retrying.body.error).toEqual({ name: "Error", message: "attempt 1 failed" });

    expect((await jobsHarness.tick()).body).toMatchObject({ retried: 1 });
    expect((await jobsHarness.tick()).body).toMatchObject({ completed: 1 });
    const done = await jobsHarness.status("flaky", body.handleId);
    expect(done.body).toMatchObject({ status: "completed", output: { calls: 3 }, error: null });
    expect(done.body.raw.attempt).toBe(3);
  });

  it("fails after the last attempt and backs off between attempts", async () => {
    const delays: number[] = [];
    const jobsHarness = harness(
      defineTasks({
        broken: task({
          defaults: { retry: { attempts: 2 } },
          async run() {
            throw new Error("still broken");
          },
        }),
      }),
      {
        retryDelayMs: (attempt) => {
          delays.push(attempt);
          return 0;
        },
      },
    );
    const { body } = await jobsHarness.trigger("broken", {});
    await jobsHarness.tick();
    await jobsHarness.tick();
    const status = await jobsHarness.status("broken", body.handleId);
    expect(status.body).toMatchObject({
      status: "failed",
      error: { name: "Error", message: "still broken" },
    });
    expect(delays).toEqual([1]);
  });

  it("does not start a delayed run before its time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const jobsHarness = harness(defineTasks({ remind: task({ run: () => "sent" }) }));
    const scheduled = await jobsHarness.send("POST", "/api/jobs/remind/schedule", {
      $schedule: { after: "10m" },
    });
    expect(scheduled.status).toBe(200);
    expect(scheduled.body.scheduledFor).toBe("10m");

    expect((await jobsHarness.tick()).body.started).toBe(0);
    expect((await jobsHarness.status("remind", scheduled.body.handleId)).body).toMatchObject({
      status: "delayed",
      raw: { nextAttemptAt: "2026-01-01T00:10:00.000Z" },
    });

    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    expect((await jobsHarness.tick()).body).toMatchObject({ started: 1, completed: 1 });
  });

  it("refuses a past or malformed schedule before storing anything", async () => {
    const jobsHarness = harness(defineTasks({ remind: task({ run: () => "sent" }) }));
    const past = await jobsHarness.send("POST", "/api/jobs/remind/schedule", {
      $schedule: { at: "2020-01-01T00:00:00Z" },
    });
    expect(past.status).toBe(400);
    expect(past.body.details).toMatchObject({ code: "JOBS_INVALID_SCHEDULE", runtime: "local" });
    const malformed = await jobsHarness.send("POST", "/api/jobs/remind/schedule", {
      $schedule: { after: "soon" },
    });
    expect(malformed.status).toBe(400);
    expect((await jobsHarness.tick()).body.started).toBe(0);
  });

  it("expires a run that was not started within its ttl", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const run = vi.fn(() => "late");
    const jobsHarness = harness(defineTasks({ fresh: task({ defaults: { ttl: 30 }, run }) }));
    const { body } = await jobsHarness.trigger("fresh", {});

    vi.setSystemTime(new Date("2026-01-01T00:00:31.000Z"));
    expect((await jobsHarness.tick()).body).toMatchObject({ started: 0, expired: 1 });
    expect((await jobsHarness.status("fresh", body.handleId)).body.status).toBe("expired");
    expect(run).not.toHaveBeenCalled();
  });

  it("returns the existing run for a repeated idempotency key", async () => {
    const jobsHarness = harness(defineTasks({ charge: task({ run: () => "charged" }) }));
    const [first, second] = await Promise.all([
      jobsHarness.trigger("charge", { $options: { idempotencyKey: "order_1" } }),
      jobsHarness.trigger("charge", { $options: { idempotencyKey: "order_1" } }),
    ]);
    expect(first.body.handleId).toBe(second.body.handleId);
    const other = await jobsHarness.trigger("charge", { $options: { idempotencyKey: "order_2" } });
    expect(other.body.handleId).not.toBe(first.body.handleId);
    expect((await jobsHarness.tick()).body.started).toBe(2);
  });

  it("cancels a running run, aborts its signal, and keeps it canceled", async () => {
    let release!: () => void;
    let signal: AbortSignal | undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const jobsHarness = harness(
      defineTasks({
        slow: task({
          async run(_input: unknown, context) {
            signal = context.signal;
            release();
            await new Promise((resolve) => context.signal?.addEventListener("abort", resolve));
            return "finished anyway";
          },
        }),
      }),
    );
    const { body } = await jobsHarness.trigger("slow", {});
    const ticking = jobsHarness.tick();
    await started;

    const canceled = await jobsHarness.send("POST", "/api/jobs/slow/cancel", {
      handleId: body.handleId,
    });
    expect(canceled.body).toEqual({
      handleId: body.handleId,
      task: "slow",
      runtime: "local",
      canceled: true,
    });
    expect(signal?.aborted).toBe(true);
    await ticking;

    expect((await jobsHarness.status("slow", body.handleId)).body).toMatchObject({
      status: "canceled",
      output: null,
    });
    const again = await jobsHarness.send("POST", "/api/jobs/slow/cancel", {
      handleId: body.handleId,
    });
    expect(again.status).toBe(409);
  });

  it("recovers a run whose process stopped mid-attempt once the lease ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const storage = memory();
    let attempts = 0;
    const tasks = defineTasks({
      work: task({
        async run(_input: unknown, context) {
          attempts += 1;
          // The first attempt never settles, standing in for a process that died.
          if (context.run?.attempt === 1) return new Promise<never>(() => {});
          return "recovered";
        },
      }),
    });
    const first = harness(tasks, { storage, leaseMs: 60_000 });
    const { body } = await first.trigger("work", {});
    void first.tick();
    await vi.waitFor(() => expect(attempts).toBe(1));

    const second = harness(tasks, { storage, leaseMs: 60_000 });
    expect((await second.tick()).body.started).toBe(0);
    // waitFor advances the fake clock while it polls, so step well past the lease.
    vi.setSystemTime(new Date("2026-01-01T00:02:00.000Z"));
    expect((await second.tick()).body).toMatchObject({ started: 1, completed: 1 });
    expect((await second.status("work", body.handleId)).body).toMatchObject({
      status: "completed",
      output: "recovered",
      raw: { attempt: 2 },
    });
  });

  it("hides runs from other tasks and unknown handles", async () => {
    const jobsHarness = harness(
      defineTasks({ a: task({ run: () => "a" }), b: task({ run: () => "b" }) }),
    );
    const { body } = await jobsHarness.trigger("a", {});
    expect((await jobsHarness.status("b", body.handleId)).status).toBe(404);
    expect((await jobsHarness.status("a", "run_../../idem")).status).toBe(404);
    const cancel = await jobsHarness.send("POST", "/api/jobs/b/cancel", {
      handleId: body.handleId,
    });
    expect(cancel.status).toBe(404);
  });

  it("removes finished runs after retentionMs", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const storage = memory();
    const jobsHarness = harness(defineTasks({ once: task({ run: () => "done" }) }), {
      storage,
      retentionMs: 60_000,
    });
    const { body } = await jobsHarness.trigger("once", { $options: { idempotencyKey: "k" } });
    await jobsHarness.tick();
    expect((await jobsHarness.status("once", body.handleId)).body.status).toBe("completed");

    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    expect((await jobsHarness.tick()).body.removed).toBe(1);
    expect((await jobsHarness.status("once", body.handleId)).status).toBe(404);
    expect(await storage.getKeys()).toEqual([]);
  });

  it("refuses task defaults it cannot honor at setup", () => {
    expect(() =>
      jobs({
        runtime: testRuntime(),
        tasks: defineTasks({
          email: task({
            defaults: { queue: "email", concurrencyKey: "user" },
            run: () => null,
          }),
        }),
      }),
    ).toThrowError(/`defaults.queue`, `defaults.concurrencyKey`, which the "local" jobs runtime/);
  });

  it("reports every invalid option at once", () => {
    expect(() =>
      local({ pollIntervalMs: 0, leaseMs: -1, tickLimit: 1.5, retryDelayMs: -5, storage: "" }),
    ).toThrowError(/pollIntervalMs[\s\S]*leaseMs[\s\S]*tickLimit[\s\S]*retryDelayMs[\s\S]*storage/);
  });

  it("refuses the in-memory default storage in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const integration = jobs({
      runtime: local({ pollIntervalMs: false }),
      tasks: defineTasks({ once: task({ run: () => "done" }) }),
    });
    const route = (integration.routes as unknown as JobsTestRoute[]).find((entry) =>
      entry.path.endsWith("/once/trigger"),
    );
    const response = await route!.handler(
      new Request("http://farm.test/api/jobs/once/trigger", { method: "POST", body: "{}" }),
      serverContext,
    );
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.details).toMatchObject({ code: "JOBS_LOCAL_STORAGE_NOT_PERSISTENT" });
    expect(body.error).toContain('"jobs" storage namespace');
  });

  it("guards the tick route with the cron secret outside development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", "s3cret");
    const jobsHarness = harness(defineTasks({ once: task({ run: () => "done" }) }));
    expect((await jobsHarness.tick()).status).toBe(401);
    expect((await jobsHarness.tick({ authorization: "Bearer wrong" })).status).toBe(401);
    const allowed = await jobsHarness.tick({ authorization: "Bearer s3cret" });
    expect(allowed.status).toBe(200);
    expect(allowed.body).toEqual({
      started: 0,
      completed: 0,
      failed: 0,
      retried: 0,
      expired: 0,
      removed: 0,
    });
  });

  it("polls for due runs after the app is ready and stops on dispose", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const run = vi.fn(() => "polled");
    const integration = jobs({
      runtime: local({ storage: memory(), pollIntervalMs: 1_000, retryDelayMs: 0 }),
      tasks: defineTasks({ once: task({ run }) }),
    }) as unknown as {
      routes: JobsTestRoute[];
      ready(context: unknown): Promise<void>;
      dispose(context: unknown): Promise<void>;
    };
    await integration.ready({});
    const route = integration.routes.find((entry) => entry.path.endsWith("/once/trigger"));
    await route!.handler(
      new Request("http://farm.test/api/jobs/once/trigger", { method: "POST", body: "{}" }),
      serverContext,
    );
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());

    await integration.dispose({});
    expect(vi.getTimerCount()).toBe(0);
  });
});
