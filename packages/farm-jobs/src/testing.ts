import { FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY } from "@farm.js/core/integrations";
import {
  defineTasks,
  jobs,
  task,
  type CustomJobsRuntimeDefinition,
  type JobsRuntimeCapabilities,
  type JobsTaskMetadata,
} from "./index.js";

type ConformanceRoute = {
  path: string;
  method: string;
  handler(request: Request, context: unknown): Response | Promise<Response>;
};

/** Calls the jobs integration's routes the way server code calling `api` does. */
export interface JobsRuntimeConformanceHarness {
  readonly capabilities: JobsRuntimeCapabilities;
  /** Calls `<basePath>/<path>` as trusted server code and returns the JSON answer. */
  request(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: any }>;
  /** Calls one of the runtime's own routes, such as `"tick"`, as its scheduler would. */
  runtimeRoute(
    method: "GET" | "POST",
    path: string,
    init?: RequestInit,
  ): Promise<{ status: number; body: any }>;
}

export interface JobsRuntimeConformanceOptions {
  /** Returns a new runtime for each case, so cases share no state. */
  runtime(): CustomJobsRuntimeDefinition | Promise<CustomJobsRuntimeDefinition>;
  /**
   * Makes started runs execute, for a runtime that calls `run` in this
   * process, for example by calling its tick route. Without it, the cases
   * that check execution are not returned.
   */
  drive?(harness: JobsRuntimeConformanceHarness): Promise<void>;
  /** How many times to call `drive` before a run must have finished. @default 5 */
  driveAttempts?: number;
}

export interface JobsRuntimeConformanceCase {
  name: string;
  run(): Promise<void>;
}

const BASE_PATH = "/api/jobs";
const UNSUPPORTED = "JOBS_RUNTIME_CAPABILITY_UNSUPPORTED";
const TERMINAL = new Set(["completed", "failed", "canceled", "expired"]);
const serverContext = {
  req: {
    get: (key: string) =>
      key === FARM_INTEGRATION_INTERNAL_DISPATCH_CONTEXT_KEY ? true : undefined,
  },
};

class ConformanceError extends Error {
  constructor(message: string, detail?: unknown) {
    super(detail === undefined ? message : `${message}\nReceived: ${JSON.stringify(detail)}`);
    this.name = "JobsRuntimeConformanceError";
  }
}

function check(condition: unknown, message: string, detail?: unknown): asserts condition {
  if (!condition) throw new ConformanceError(message, detail);
}

function createTasks(capabilities: JobsRuntimeCapabilities) {
  return defineTasks({
    echo: task({
      async run(input: { value: string }) {
        return { echoed: input.value };
      },
    }),
    other: task({
      async run(input: { value: string }) {
        return { other: input.value };
      },
    }),
    explode: task({
      ...(capabilities.retry ? { defaults: { retry: false as const } } : {}),
      async run(_input: { value: string }): Promise<never> {
        throw new Error("conformance failure");
      },
    }),
  });
}

async function disposeIntegration(integration: unknown) {
  await (integration as { dispose?: (context?: unknown) => unknown }).dispose?.({});
}

/** Builds a throwaway integration to read what the runtime declares. */
async function readCapabilities(options: JobsRuntimeConformanceOptions) {
  const integration = jobs({
    runtime: await options.runtime(),
    tasks: defineTasks({ probe: task({ run: () => null }) }),
  });
  try {
    return (integration.instance as { tasks: JobsTaskMetadata<string>[] }).tasks[0]!.capabilities;
  } finally {
    await disposeIntegration(integration);
  }
}

async function setup(options: JobsRuntimeConformanceOptions) {
  const capabilities = await readCapabilities(options);
  const integration = jobs({
    runtime: await options.runtime(),
    tasks: createTasks(capabilities),
  });
  const metadata = (integration.instance as { tasks: JobsTaskMetadata<string>[] }).tasks;
  const routes = integration.routes as unknown as ConformanceRoute[];
  const find = (method: string, path: string) =>
    routes.find((route) => route.method === method && route.path === path);

  async function call(route: ConformanceRoute | undefined, request: Request, label: string) {
    check(route, `No route answers ${label}.`);
    const response = await route.handler(request, serverContext);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {}
    return { status: response.status, body: body as any };
  }

  const harness: JobsRuntimeConformanceHarness = {
    capabilities,
    request(method, path, body) {
      const full = `${BASE_PATH}/${path}`;
      const url = new URL(full, "http://conformance.test");
      return call(
        find(method, url.pathname),
        new Request(url, {
          method,
          ...(body === undefined
            ? {}
            : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }),
        }),
        `${method} ${full}`,
      );
    },
    runtimeRoute(method, path, init) {
      const kind = metadata[0]!.runtime;
      const full = `${BASE_PATH}/_runtime/${kind}/${path}`;
      return call(
        find(method, full),
        new Request(new URL(full, "http://conformance.test"), { ...init, method }),
        `${method} ${full}`,
      );
    },
  };

  return { harness, dispose: () => disposeIntegration(integration) };
}

function expectUnsupported(
  result: { status: number; body: any },
  capability: string,
  status: number,
) {
  check(
    result.status === status && result.body?.details?.code === UNSUPPORTED,
    `Expected ${status} with code ${UNSUPPORTED} for the unsupported "${capability}" capability.`,
    result,
  );
  check(
    result.body.details.capability === capability,
    `Expected the error to name the "${capability}" capability.`,
    result.body.details,
  );
}

async function triggerEcho(
  harness: JobsRuntimeConformanceHarness,
  value: string,
  options?: object,
) {
  const result = await harness.request("POST", "echo/trigger", {
    value,
    ...(options ? { $options: options } : {}),
  });
  check(
    result.status === 200 && typeof result.body?.handleId === "string" && result.body.handleId,
    "Expected trigger to answer 200 with a non-empty handleId.",
    result,
  );
  return result.body.handleId as string;
}

async function waitForTerminal(
  options: JobsRuntimeConformanceOptions,
  harness: JobsRuntimeConformanceHarness,
  taskPath: string,
  handleId: string,
) {
  const attempts = options.driveAttempts ?? 5;
  let last: { status: number; body: any } | undefined;
  for (let index = 0; index < attempts; index += 1) {
    await options.drive!(harness);
    last = await harness.request(
      "GET",
      `${taskPath}/status?handleId=${encodeURIComponent(handleId)}`,
    );
    if (last.status === 200 && TERMINAL.has(last.body?.status)) return last.body;
  }
  throw new ConformanceError(`Run ${handleId} did not finish after ${attempts} drive calls.`, last);
}

/**
 * The behavior every jobs runtime must have, as framework-agnostic cases.
 * Register each with your test runner:
 *
 * ```ts
 * for (const conformance of createJobsRuntimeConformance({ runtime: () => myRuntime() })) {
 *   it(conformance.name, conformance.run);
 * }
 * ```
 *
 * Cases for capabilities the runtime declares as unsupported check that Farm
 * refuses them; cases that need `drive` are left out without it.
 */
export function createJobsRuntimeConformance(
  options: JobsRuntimeConformanceOptions,
): JobsRuntimeConformanceCase[] {
  const cases: JobsRuntimeConformanceCase[] = [];
  const add = (name: string, body: (harness: JobsRuntimeConformanceHarness) => Promise<void>) => {
    cases.push({
      name,
      async run() {
        const { harness, dispose } = await setup(options);
        try {
          await body(harness);
        } finally {
          await dispose();
        }
      },
    });
  };

  add("reports its kind and capabilities in task metadata", async (harness) => {
    const list = await harness.request("GET", "tasks");
    check(list.status === 200 && Array.isArray(list.body), "Expected the task list.", list);
    for (const entry of list.body as JobsTaskMetadata<string>[]) {
      check(
        typeof entry.runtime === "string" && entry.runtime.length > 0,
        "Missing runtime kind.",
        entry,
      );
      check(
        entry.capabilities && typeof entry.capabilities === "object",
        "Missing capabilities.",
        entry,
      );
    }
  });

  add("returns a run handle from trigger", async (harness) => {
    await triggerEcho(harness, "handle");
  });

  add("reads the status of a run it started", async (harness) => {
    const handleId = await triggerEcho(harness, "status");
    const result = await harness.request(
      "GET",
      `echo/status?handleId=${encodeURIComponent(handleId)}`,
    );
    check(result.status === 200, "Expected status to answer 200.", result);
    check(result.body.handleId === handleId, "Expected status to echo the handleId.", result.body);
    check(result.body.task === "echo", "Expected status to name the task.", result.body);
  });

  add("refuses to read another task's run", async (harness) => {
    const handleId = await triggerEcho(harness, "isolation");
    const result = await harness.request(
      "GET",
      `other/status?handleId=${encodeURIComponent(handleId)}`,
    );
    check(result.status === 404, "Expected 404 when a task reads another task's run.", result);
  });

  add("handles idempotency keys as declared", async (harness) => {
    if (!harness.capabilities.idempotencyKey) {
      const result = await harness.request("POST", "echo/trigger", {
        value: "idem",
        $options: { idempotencyKey: "conformance" },
      });
      expectUnsupported(result, "idempotencyKey", 400);
      return;
    }
    const first = await triggerEcho(harness, "idem", { idempotencyKey: "conformance" });
    const second = await triggerEcho(harness, "idem", { idempotencyKey: "conformance" });
    check(first === second, "Expected the same idempotency key to return the same run.", {
      first,
      second,
    });
  });

  add("refuses per-call options it does not support", async (harness) => {
    const checks: [keyof JobsRuntimeCapabilities, object][] = [
      ["tags", { tags: ["conformance"] }],
      ["debounce", { debounce: { key: "conformance", delay: "1m" } }],
      ["delay", { delay: "1m" }],
    ];
    for (const [capability, launch] of checks) {
      if (harness.capabilities[capability]) continue;
      const result = await harness.request("POST", "echo/trigger", {
        value: "x",
        $options: launch,
      });
      expectUnsupported(result, capability, 400);
    }
  });

  add("schedules and cancels as declared", async (harness) => {
    const scheduled = await harness.request("POST", "echo/schedule", {
      value: "later",
      $schedule: { after: "1h" },
    });
    if (!harness.capabilities.schedule) {
      expectUnsupported(scheduled, "schedule", 501);
      return;
    }
    check(
      scheduled.status === 200 && scheduled.body.handleId,
      "Expected schedule to answer 200.",
      scheduled,
    );
    const canceled = await harness.request("POST", "echo/cancel", {
      handleId: scheduled.body.handleId,
    });
    if (!harness.capabilities.cancel) {
      expectUnsupported(canceled, "cancel", 501);
      return;
    }
    check(
      canceled.status === 200 && canceled.body.canceled === true,
      "Expected cancel to answer 200.",
      canceled,
    );
    const status = await harness.request(
      "GET",
      `echo/status?handleId=${encodeURIComponent(scheduled.body.handleId)}`,
    );
    check(
      status.body?.status === "canceled",
      "Expected a canceled run to report canceled.",
      status,
    );
  });

  add("batch triggers as declared", async (harness) => {
    const result = await harness.request("POST", "echo/batch-trigger", {
      items: [{ value: "a" }, { value: "b" }],
    });
    if (!harness.capabilities.batchTrigger) {
      expectUnsupported(result, "batchTrigger", 501);
      return;
    }
    check(
      result.status === 200 && Array.isArray(result.body.runs) && result.body.runs.length === 2,
      "Expected a batch of two items to return two runs.",
      result,
    );
  });

  if (options.drive) {
    add("runs a task to completion with its output", async (harness) => {
      const handleId = await triggerEcho(harness, "done");
      const status = await waitForTerminal(options, harness, "echo", handleId);
      check(status.status === "completed", "Expected the run to complete.", status);
      check(status.output?.echoed === "done", "Expected the run's output.", status);
    });

    add("reports a failing task as failed with its error", async (harness) => {
      const queued = await harness.request("POST", "explode/trigger", { value: "x" });
      check(queued.status === 200, "Expected trigger to answer 200.", queued);
      const status = await waitForTerminal(options, harness, "explode", queued.body.handleId);
      check(status.status === "failed", "Expected the run to fail.", status);
      check(
        JSON.stringify(status.error ?? null).includes("conformance failure"),
        "Expected the run's error message.",
        status,
      );
    });
  }

  return cases;
}
