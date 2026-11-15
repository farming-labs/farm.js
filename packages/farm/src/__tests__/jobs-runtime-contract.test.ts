// @vitest-environment node
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  defineJobsRuntime,
  defineTasks,
  JOBS_RUNTIME_CONTRACT,
  JobsRuntimeError,
  jobs,
  local,
  task,
  trigger,
  type InferJobsRuntimeKind,
  type JobsRuntime,
  type JobsRuntimeCapabilities,
  type JobsRuntimeKind,
  type JobsTriggerResult,
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

const NONE: JobsRuntimeCapabilities = {
  delay: false,
  schedule: false,
  debounce: false,
  tags: false,
  cancel: false,
  batchTrigger: false,
  queue: false,
  retry: false,
  ttl: false,
  concurrencyKey: false,
  idempotencyKey: false,
};

/** A runtime that only records launches: the smallest thing the contract accepts. */
function recordingRuntime(overrides: Partial<JobsRuntime> = {}) {
  const runs = new Map<string, { task: string; input: unknown }>();
  let next = 0;
  return defineJobsRuntime({
    kind: "recording",
    create: () => ({
      capabilities: NONE,
      async trigger(task, input) {
        const handleId = `rec_${++next}`;
        runs.set(handleId, { task: task.key, input });
        return { handleId };
      },
      async status(task, handleId) {
        const run = runs.get(handleId);
        if (!run || run.task !== task.key) {
          throw new JobsRuntimeError(`Run ${handleId} was not found for task "${task.key}".`, 404);
        }
        return { status: "queued" };
      },
      ...overrides,
    }),
  });
}

const echoTasks = defineTasks({
  echo: task({
    async run(input: { value: string }) {
      return input;
    },
  }),
});

function routesOf(integration: { routes?: unknown }) {
  return integration.routes as unknown as JobsTestRoute[];
}

describe("jobs runtime contract", () => {
  describe("conformance suite against a runtime with no optional capabilities", () => {
    for (const conformance of createJobsRuntimeConformance({ runtime: () => recordingRuntime() })) {
      it(conformance.name, conformance.run);
    }
  });

  it("keeps built-in result types and infers a custom runtime's kind", () => {
    expectTypeOf<
      InferJobsRuntimeKind<ReturnType<typeof trigger>>
    >().toEqualTypeOf<JobsRuntimeKind>();
    expectTypeOf<InferJobsRuntimeKind<ReturnType<typeof local>>>().toEqualTypeOf<"local">();
    expectTypeOf<JobsTriggerResult["runtime"]>().toEqualTypeOf<JobsRuntimeKind>();

    const builtIn = jobs({ runtime: trigger({ apiKey: "tr_dev_test" }), tasks: echoTasks });
    expectTypeOf(builtIn.instance.runtime).toEqualTypeOf<JobsRuntimeKind>();
    const custom = jobs({ runtime: recordingRuntime(), tasks: echoTasks });
    expectTypeOf(custom.instance.runtime).toEqualTypeOf<"recording">();
    expect(custom.instance.runtime).toBe("recording");
  });

  it("reports every problem with a runtime definition at once", () => {
    const definition = {
      ...defineJobsRuntime({ kind: "Bad Kind", create: () => ({}) as JobsRuntime }),
      contract: JOBS_RUNTIME_CONTRACT + 1,
    };
    expect(() => jobs({ runtime: definition, tasks: echoTasks })).toThrowError(
      /`kind` must be lowercase[\s\S]*built for jobs runtime contract 2/,
    );
  });

  it("reserves the built-in kinds", () => {
    const definition = defineJobsRuntime({ kind: "trigger", create: () => ({}) as JobsRuntime });
    expect(() => jobs({ runtime: definition, tasks: echoTasks })).toThrowError(
      /"trigger" is reserved for the built-in trigger\(\) runtime/,
    );
  });

  it("reports every problem with a created runtime at once", () => {
    const definition = defineJobsRuntime({
      kind: "broken",
      create: () =>
        ({
          capabilities: { ...NONE, cancel: true, ttl: undefined },
          trigger: async () => ({ handleId: "x" }),
          routes: [{ method: "GET", path: "Tick", handler: () => new Response() }],
        }) as unknown as JobsRuntime,
    });
    let message = "";
    try {
      jobs({ runtime: definition, tasks: echoTasks });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("needs a boolean for `ttl`");
    expect(message).toContain("`status` must be a function");
    expect(message).toContain("`capabilities.cancel` is true, so `cancel` must be a function");
    expect(message).toContain("`routes[0].path` must be lowercase");
    expect(message).toContain("`routes[0].verify` must be a function");
  });

  it("refuses task defaults the runtime does not support at setup", () => {
    expect(() =>
      jobs({
        runtime: recordingRuntime(),
        tasks: defineTasks({
          email: task({
            defaults: { queue: "email", ttl: "5m" },
            async run() {
              return null;
            },
          }),
        }),
      }),
    ).toThrowError(
      'Task "email" sets `defaults.queue`, `defaults.ttl`, which the "recording" jobs runtime does not support.',
    );
  });

  it("throws for a runtime kind it does not know instead of falling back to Inngest", () => {
    expect(() =>
      jobs({
        runtime: { kind: "Inngest", config: {} } as never,
        tasks: echoTasks,
      }),
    ).toThrowError(/Unknown jobs runtime "Inngest"/);
  });

  it("returns the handles that started when a batch fallback fails partway", async () => {
    let calls = 0;
    const integration = jobs({
      runtime: recordingRuntime({
        capabilities: { ...NONE, batchTrigger: true },
        async trigger() {
          calls += 1;
          if (calls === 2) throw new JobsRuntimeError("provider unavailable", 503);
          return { handleId: `rec_${calls}` };
        },
      }),
      tasks: echoTasks,
    });
    const route = routesOf(integration).find((entry) => entry.path.endsWith("/batch-trigger"));
    const response = await route!.handler(
      new Request("http://farm.test/api/jobs/echo/batch-trigger", {
        method: "POST",
        body: JSON.stringify({ items: [{ value: "a" }, { value: "b" }, { value: "c" }] }),
      }),
      serverContext,
    );
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.details).toMatchObject({
      code: "JOBS_BATCH_PARTIAL",
      failedIndex: 1,
      runs: [{ index: 0, handleId: "rec_1" }],
    });
    expect(calls).toBe(2);
  });

  it("mounts runtime routes behind their own verify", async () => {
    const handler = vi.fn(() => Response.json({ ok: true }));
    const integration = jobs({
      runtime: recordingRuntime({
        routes: [
          {
            method: "POST",
            path: "webhook",
            verify: (request) =>
              request.headers.get("x-signature") === "valid"
                ? true
                : request.headers.has("x-signature")
                  ? new Response("bad signature", { status: 400 })
                  : false,
            handler,
          },
        ],
      }),
      tasks: echoTasks,
    });
    const route = routesOf(integration).find(
      (entry) => entry.path === "/api/jobs/_runtime/recording/webhook",
    );
    expect(route?.method).toBe("POST");
    const send = (headers: Record<string, string>) =>
      route!.handler(
        new Request("http://farm.test/api/jobs/_runtime/recording/webhook", {
          method: "POST",
          headers,
        }),
        serverContext,
      );

    // In-process server dispatch does not skip a runtime route's verify.
    expect((await send({})).status).toBe(401);
    expect((await send({ "x-signature": "forged" })).status).toBe(400);
    expect(handler).not.toHaveBeenCalled();
    expect((await send({ "x-signature": "valid" })).status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });

  it("starts the runtime when the app is ready and disposes it once on shutdown", async () => {
    const start = vi.fn();
    const dispose = vi.fn();
    const integration = jobs({
      runtime: recordingRuntime({ start, dispose }),
      tasks: echoTasks,
    }) as unknown as {
      ready(context: unknown): Promise<void>;
      dispose(context: unknown): Promise<void>;
    };

    expect(start).not.toHaveBeenCalled();
    await integration.ready({});
    await integration.dispose({});
    await integration.dispose({});
    expect(start).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("gives the runtime a context that runs tasks in this process", async () => {
    let captured: Parameters<Parameters<typeof defineJobsRuntime>[0]["create"]>[0] | undefined;
    const signal = new AbortController().signal;
    const seen: unknown[] = [];
    jobs({
      runtime: defineJobsRuntime({
        kind: "inline",
        create(context) {
          captured = context;
          return {
            capabilities: NONE,
            trigger: async () => ({ handleId: "x" }),
            status: async () => ({ status: "unknown" }),
          };
        },
      }),
      tasks: defineTasks({
        greet: task({
          async run(input: { name: string }, context) {
            seen.push(context.runtime, context.task, context.run, context.signal === signal);
            return `hi ${input.name}`;
          },
        }),
        fail: task({
          async run() {
            throw new TypeError("bad input");
          },
        }),
      }),
    });

    expect(captured!.routePath("tick")).toBe("/api/jobs/_runtime/inline/tick");
    expect(captured!.getTask("greet")).toMatchObject({
      key: "greet",
      id: "greet",
      remoteId: "greet",
    });
    await expect(
      captured!.execute({
        task: "greet",
        input: { name: "Ada" },
        run: { id: "r1", attempt: 1 },
        signal,
      }),
    ).resolves.toEqual({ ok: true, output: "hi Ada" });
    expect(seen).toEqual(["inline", { key: "greet", id: "greet" }, { id: "r1", attempt: 1 }, true]);
    await expect(
      captured!.execute({ task: "fail", input: undefined, run: { id: "r2", attempt: 1 } }),
    ).resolves.toEqual({ ok: false, error: { name: "TypeError", message: "bad input" } });
    await expect(
      captured!.execute({ task: "missing", input: undefined, run: { id: "r3", attempt: 1 } }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
