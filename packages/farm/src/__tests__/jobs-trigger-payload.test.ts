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
});
