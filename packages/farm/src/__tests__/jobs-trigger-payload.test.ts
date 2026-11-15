// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIntegrationServerClient } from "../integration-client";
import { defineTasks, jobs, task, trigger } from "../../../farm-integrations/src/jobs/index";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function createApi(tasks: Parameters<typeof jobs>[0]["tasks"]) {
  const integration = jobs({
    runtime: trigger({ apiKey: "tr_dev_test" }),
    tasks,
  });
  return createIntegrationServerClient(
    { integrations: { jobs: integration } },
    { request: new Request("https://farmjs.dev/jobs") },
  );
}

function sentPayload(fetchSpy: ReturnType<typeof vi.spyOn>, callIndex: number): unknown {
  const init = fetchSpy.mock.calls[callIndex]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)).payload;
}

describe("jobs trigger payload shapes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delivers scalar { $value } bodies unwrapped, matching the legacy input form", async () => {
    const tasks = defineTasks({
      countTokens: task({
        description: "Scalar input task.",
        async run(input: number) {
          return { doubled: input * 2 };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_1" }));
    const api = createApi(tasks);

    // The typed body for a scalar TInput is { $value: TInput }. The marker is
    // reserved and $-prefixed so it cannot collide with payload data.
    const typed = await api.jobs.countTokens.trigger({ body: { $value: 42 } });
    expect(typed.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toBe(42);

    // The legacy { input } form must deliver the identical payload.
    const legacy = await api.jobs.countTokens.trigger({ body: { input: 42 } });
    expect(legacy.error).toBeNull();
    expect(sentPayload(fetchSpy, 1)).toBe(42);
  });

  it("keeps object inputs inline, including ones with their own value field", async () => {
    const tasks = defineTasks({
      recordWeight: task({
        description: "Object input task with a value field.",
        async run(input: { value: number; unit: string }) {
          return { stored: `${input.value}${input.unit}` };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_2" }));
    const api = createApi(tasks);

    const result = await api.jobs.recordWeight.trigger({
      body: { value: 3, unit: "kg" },
    });
    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({ value: 3, unit: "kg" });
  });

  it("keeps a single-key object input whose only field is named value", async () => {
    // The wrapper used to be a bare { value }, so an object input carrying
    // exactly one "value" field was indistinguishable from it and arrived at
    // the provider as the bare scalar instead of the object.
    const tasks = defineTasks({
      storeNote: task({
        description: "Object input whose only field is value.",
        async run(input: { value: string }) {
          return { stored: input.value };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_3" }));
    const api = createApi(tasks);

    const result = await api.jobs.storeNote.trigger({ body: { value: "hello" } });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({ value: "hello" });
  });

  it("still reads a bare { input } body as the documented legacy envelope", async () => {
    // The { input, options } envelope is documented as still accepted, so a
    // body of exactly { input } is read as that envelope and unwrapped. An
    // object input whose only field is named "input" is therefore still
    // ambiguous on the wire; retiring that collision means deprecating the
    // legacy envelope, which is tracked separately in #1313.
    const tasks = defineTasks({
      storeCount: task({
        description: "Object input whose only field is input.",
        async run(payload: { input: number }) {
          return { stored: payload.input };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_4" }));
    const api = createApi(tasks);

    const result = await api.jobs.storeCount.trigger({ body: { input: 5 } });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toBe(5);
  });

  it("preserves input-only objects with the explicit input envelope", async () => {
    const tasks = defineTasks({
      storeCount: task({
        description: "Object input whose only field is input.",
        async run(payload: { input: number }) {
          return { stored: payload.input };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_5" }));
    const api = createApi(tasks);

    const result = await api.jobs.storeCount.trigger({
      body: { $input: { input: 5 } },
    });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({ input: 5 });
  });

  it("preserves input-only objects when scheduling with the explicit envelope", async () => {
    const tasks = defineTasks({
      storeCount: task({
        description: "Object input whose only field is input.",
        async run(payload: { input: number }) {
          return { stored: payload.input };
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_6" }));
    const api = createApi(tasks);

    const result = await api.jobs.storeCount.schedule({
      body: {
        $input: { input: 5 },
        $schedule: { after: "10m" },
      },
    });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({ input: 5 });
  });

  it("delivers an object input that carries $value alongside other fields whole", async () => {
    const tasks = defineTasks({
      charge: task({
        description: "Object input with a $value field.",
        async run(input: { amount: number; $value: string }) {
          return input;
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_7" }));
    const api = createApi(tasks);

    const result = await api.jobs.charge.trigger({ body: { amount: 5, $value: "x" } as never });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({ amount: 5, $value: "x" });
  });

  it("delivers an empty object input as {}", async () => {
    const tasks = defineTasks({
      reindex: task({
        description: "Object input whose fields are all optional.",
        async run(input: { full?: boolean }) {
          return input;
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_8" }));
    const api = createApi(tasks);

    const result = await api.jobs.reindex.trigger({ body: {} });

    expect(result.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual({});
  });

  it("delivers array inputs sent as the body or as batch items", async () => {
    const tasks = defineTasks({
      sumAll: task({
        description: "Array input task.",
        async run(input: number[]) {
          return input.reduce((total, value) => total + value, 0);
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(async () => jsonResponse({ id: "run_9" }))
      .mockImplementationOnce(async () => jsonResponse({ batchId: "batch_1", runs: ["run_10"] }));
    const api = createApi(tasks);

    const triggered = await api.jobs.sumAll.trigger({ body: [1, 2, 3] as never });
    expect(triggered.error).toBeNull();
    expect(sentPayload(fetchSpy, 0)).toEqual([1, 2, 3]);

    const batched = await api.jobs.sumAll.batchTrigger({ body: { items: [[4, 5]] as never } });
    expect(batched.error).toBeNull();
    const init = fetchSpy.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(JSON.parse(String(init?.body)).items[0].payload).toEqual([4, 5]);
  });

  it("applies $options launch options when scheduling with the explicit envelope", async () => {
    const tasks = defineTasks({
      sendReport: task({
        description: "Scheduled object input.",
        async run(input: { reportId: string }) {
          return input;
        },
      }),
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => jsonResponse({ id: "run_11" }));
    const api = createApi(tasks);

    const result = await api.jobs.sendReport.schedule({
      body: {
        $input: { reportId: "rep_1" },
        $options: { idempotencyKey: "report:rep_1", tags: ["reports"] },
        $schedule: { after: "10m", tags: ["scheduled"] },
      },
    });

    expect(result.error).toBeNull();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const sent = JSON.parse(String(init?.body));
    expect(sent.payload).toEqual({ reportId: "rep_1" });
    expect(sent.options.idempotencyKey).toBe("report:rep_1");
    expect(sent.options.tags).toEqual(["reports", "scheduled"]);
  });
});
