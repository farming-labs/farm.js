// @vitest-environment node
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createIntegrationServerClient } from "../integration-client";
import {
  defineTasks,
  inngest,
  jobs,
  task,
  trigger,
  type InferJobsTaskInput,
  type InferJobsTaskOutput,
} from "../../../farm-integrations/src/jobs/index";

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("jobs integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("infers task input/output types and exposes task metadata", async () => {
    const tasks = defineTasks({
      sendWelcomeEmail: task({
        description: "Send a welcome email after signup.",
        defaults: {
          queue: {
            name: "email",
            concurrencyLimit: 2,
          },
          retry: {
            attempts: 3,
          },
          ttl: "5m",
          tags: ["system"],
          concurrencyKey(input: { userId: string }) {
            return `user:${input.userId}`;
          },
          idempotencyKey(input: { userId: string }) {
            return `welcome:${input.userId}`;
          },
        },
        async run(input: { userId: string }) {
          return {
            messageId: `msg_${input.userId}`,
          };
        },
      }),
      nightlyCleanup: task<void, { deleted: number }>({
        description: "Delete expired sessions every night.",
        schedule: {
          cron: "0 2 * * *",
          timezone: "Africa/Addis_Ababa",
        },
        async run() {
          return {
            deleted: 12,
          };
        },
      }),
    });

    expectTypeOf<InferJobsTaskInput<(typeof tasks)["sendWelcomeEmail"]>>().toEqualTypeOf<{
      userId: string;
    }>();
    expectTypeOf<InferJobsTaskOutput<(typeof tasks)["sendWelcomeEmail"]>>().toEqualTypeOf<{
      messageId: string;
    }>();

    const integration = jobs({
      runtime: trigger({
        apiKey: "tr_dev_test",
      }),
      tasks,
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/dashboard"),
      },
    );

    const result = await api.jobs.tasks.list();

    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      {
        key: "sendWelcomeEmail",
        id: "send-welcome-email",
        remoteId: "send-welcome-email",
        description: "Send a welcome email after signup.",
        schedule: null,
        runtime: "trigger",
        configured: true,
        capabilities: {
          delay: true,
          schedule: true,
          debounce: true,
          tags: true,
          cancel: true,
          batchTrigger: true,
          queue: true,
          retry: true,
          ttl: true,
          concurrencyKey: true,
          idempotencyKey: true,
        },
        paths: {
          trigger: "/api/jobs/send-welcome-email/trigger",
          schedule: "/api/jobs/send-welcome-email/schedule",
          batchTrigger: "/api/jobs/send-welcome-email/batch-trigger",
          status: "/api/jobs/send-welcome-email/status",
          cancel: "/api/jobs/send-welcome-email/cancel",
        },
        defaults: {
          queue: {
            name: "email",
            concurrencyLimit: 2,
          },
          retryAttempts: 3,
          ttl: "5m",
          tags: ["system"],
          hasConcurrencyKey: true,
          hasIdempotencyKey: true,
        },
      },
      {
        key: "nightlyCleanup",
        id: "nightly-cleanup",
        remoteId: "nightly-cleanup",
        description: "Delete expired sessions every night.",
        schedule: {
          cron: "0 2 * * *",
          timezone: "Africa/Addis_Ababa",
        },
        runtime: "trigger",
        configured: true,
        capabilities: {
          delay: true,
          schedule: true,
          debounce: true,
          tags: true,
          cancel: true,
          batchTrigger: true,
          queue: true,
          retry: true,
          ttl: true,
          concurrencyKey: true,
          idempotencyKey: true,
        },
        paths: {
          trigger: "/api/jobs/nightly-cleanup/trigger",
          schedule: "/api/jobs/nightly-cleanup/schedule",
          batchTrigger: "/api/jobs/nightly-cleanup/batch-trigger",
          status: "/api/jobs/nightly-cleanup/status",
          cancel: "/api/jobs/nightly-cleanup/cancel",
        },
        defaults: {
          queue: null,
          retryAttempts: null,
          ttl: null,
          tags: [],
          hasConcurrencyKey: false,
          hasIdempotencyKey: false,
        },
      },
    ]);
  });

  it("merges trigger defaults into Trigger.dev launch payloads and normalizes run status", async () => {
    const tasks = defineTasks({
      sendWelcomeEmail: task({
        defaults: {
          queue: {
            name: "email",
            concurrencyLimit: 2,
          },
          retry: {
            attempts: 3,
          },
          ttl: "5m",
          tags: ["system"],
          concurrencyKey(input: { userId: string }) {
            return `user:${input.userId}`;
          },
          idempotencyKey(input: { userId: string }) {
            return `welcome:${input.userId}`;
          },
        },
        async run(input: { userId: string }) {
          return {
            messageId: `msg_${input.userId}`,
          };
        },
      }),
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ id: "run_123" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "run_123",
          status: "COMPLETED",
          createdAt: "2026-04-15T08:00:00.000Z",
          startedAt: "2026-04-15T08:01:00.000Z",
          finishedAt: "2026-04-15T08:02:00.000Z",
          output: {
            messageId: "msg_usr_123",
          },
          tags: ["system", "signup"],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const integration = jobs({
      runtime: trigger({
        apiKey: "tr_dev_test",
      }),
      tasks,
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const triggerResult = await api.jobs.sendWelcomeEmail.trigger({
      body: {
        userId: "usr_123",
        $options: {
          delay: new Date("2026-04-15T08:10:00.000Z"),
          debounce: {
            key: "welcome:usr_123",
            delay: "30s",
          },
          tags: ["signup"],
        },
      },
    });

    expect(triggerResult.error).toBeNull();
    expect(triggerResult.data).toMatchObject({
      handleId: "run_123",
      task: "sendWelcomeEmail",
      runtime: "trigger",
      providerTaskId: "send-welcome-email",
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://api.trigger.dev/api/v1/tasks/send-welcome-email/trigger",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tr_dev_test",
        }),
      }),
    );

    const triggerBody = JSON.parse(
      String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0][1] as RequestInit).body),
    );
    expect(triggerBody).toEqual({
      payload: {
        userId: "usr_123",
      },
      context: {
        source: "farmjs/jobs",
        task: "sendWelcomeEmail",
      },
      options: {
        idempotencyKey: "welcome:usr_123",
        concurrencyKey: "user:usr_123",
        queue: {
          name: "email",
          concurrencyLimit: 2,
        },
        maxAttempts: 3,
        ttl: "5m",
        tags: ["system", "signup"],
        delay: "2026-04-15T08:10:00.000Z",
        debounce: {
          key: "welcome:usr_123",
          delay: "30s",
        },
      },
    });

    const statusResult = await api.jobs.sendWelcomeEmail.status({
      query: {
        handleId: "run_123",
      },
    });

    expect(statusResult.error).toBeNull();
    expect(statusResult.data).toEqual({
      handleId: "run_123",
      providerRunId: "run_123",
      task: "sendWelcomeEmail",
      runtime: "trigger",
      status: "completed",
      providerStatus: "COMPLETED",
      queuedAt: "2026-04-15T08:00:00.000Z",
      startedAt: "2026-04-15T08:01:00.000Z",
      finishedAt: "2026-04-15T08:02:00.000Z",
      output: {
        messageId: "msg_usr_123",
      },
      error: null,
      tags: ["system", "signup"],
      raw: {
        id: "run_123",
        status: "COMPLETED",
        createdAt: "2026-04-15T08:00:00.000Z",
        startedAt: "2026-04-15T08:01:00.000Z",
        finishedAt: "2026-04-15T08:02:00.000Z",
        output: {
          messageId: "msg_usr_123",
        },
        tags: ["system", "signup"],
      },
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://api.trigger.dev/api/v3/runs/run_123",
      expect.objectContaining({
        method: "GET",
      }),
    );

    const cancelResult = await api.jobs.sendWelcomeEmail.cancel({
      body: {
        handleId: "run_123",
      },
    });

    expect(cancelResult.error).toBeNull();
    expect(cancelResult.data).toEqual({
      handleId: "run_123",
      task: "sendWelcomeEmail",
      runtime: "trigger",
      canceled: true,
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "https://api.trigger.dev/api/v2/runs/run_123/cancel",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("schedules a one-off Trigger.dev run with at or after timing", async () => {
    const tasks = defineTasks({
      sendWelcomeEmail: task({
        defaults: {
          tags: ["system"],
          idempotencyKey(input: { userId: string }) {
            return `welcome:${input.userId}`;
          },
        },
        async run(input: { userId: string }) {
          return {
            messageId: `msg_${input.userId}`,
          };
        },
      }),
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        id: "run_scheduled_123",
      }),
    );

    const integration = jobs({
      runtime: trigger({
        apiKey: "tr_dev_test",
      }),
      tasks,
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const result = await api.jobs.sendWelcomeEmail.schedule({
      body: {
        userId: "usr_123",
        $schedule: {
          at: new Date("2026-04-15T10:00:00.000Z"),
          tags: ["scheduled"],
        },
      },
    });

    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({
      handleId: "run_scheduled_123",
      task: "sendWelcomeEmail",
      runtime: "trigger",
      providerTaskId: "send-welcome-email",
      scheduledFor: "2026-04-15T10:00:00.000Z",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.trigger.dev/api/v1/tasks/send-welcome-email/trigger",
      expect.objectContaining({
        method: "POST",
      }),
    );

    expect(
      JSON.parse(
        String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0][1] as RequestInit).body),
      ),
    ).toEqual({
      payload: {
        userId: "usr_123",
      },
      context: {
        source: "farmjs/jobs",
        task: "sendWelcomeEmail",
      },
      options: {
        idempotencyKey: "welcome:usr_123",
        tags: ["system", "scheduled"],
        delay: "2026-04-15T10:00:00.000Z",
      },
    });
  });

  it("batch triggers Trigger.dev runs for fan-out workflows", async () => {
    const tasks = defineTasks({
      sendWelcomeEmail: task({
        defaults: {
          retry: {
            attempts: 2,
          },
          tags: ["system"],
          idempotencyKey(input: { userId: string }) {
            return `welcome:${input.userId}`;
          },
        },
        async run(input: { userId: string }) {
          return {
            messageId: `msg_${input.userId}`,
          };
        },
      }),
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        batchId: "batch_123",
        runs: ["run_1", "run_2"],
      }),
    );

    const integration = jobs({
      runtime: trigger({
        apiKey: "tr_dev_test",
      }),
      tasks,
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const result = await api.jobs.sendWelcomeEmail.batchTrigger({
      body: {
        items: [
          {
            userId: "usr_1",
            $options: {
              tags: ["batch"],
            },
          },
          {
            userId: "usr_2",
            $options: {
              delay: "5m",
            },
          },
        ],
      },
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      batchId: "batch_123",
      task: "sendWelcomeEmail",
      runtime: "trigger",
      providerTaskId: "send-welcome-email",
      runs: [
        {
          index: 0,
          handleId: "run_1",
          queuedAt: expect.any(String),
        },
        {
          index: 1,
          handleId: "run_2",
          queuedAt: expect.any(String),
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.trigger.dev/api/v1/tasks/send-welcome-email/batch",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer tr_dev_test",
        }),
      }),
    );

    expect(
      JSON.parse(
        String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0][1] as RequestInit).body),
      ),
    ).toEqual({
      items: [
        {
          payload: {
            userId: "usr_1",
          },
          options: {
            idempotencyKey: "welcome:usr_1",
            maxAttempts: 2,
            tags: ["system", "batch"],
          },
        },
        {
          payload: {
            userId: "usr_2",
          },
          options: {
            idempotencyKey: "welcome:usr_2",
            maxAttempts: 2,
            tags: ["system"],
            delay: "5m",
          },
        },
      ],
    });
  });

  it("triggers Inngest events and resolves run status from the event handle", async () => {
    const tasks = defineTasks({
      importCsv: task({
        id: "import-csv",
        defaults: {
          idempotencyKey(input: { fileId: string }) {
            return `import:${input.fileId}`;
          },
        },
        async run(input: { fileId: string }) {
          return {
            processed: input.fileId.length,
          };
        },
      }),
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          ids: ["evt_123"],
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              run_id: "run_ing_123",
              status: "Completed",
              run_started_at: "2026-04-15T09:00:00.000Z",
              ended_at: "2026-04-15T09:01:00.000Z",
              output: {
                processed: 6,
              },
            },
          ],
        }),
      );

    const integration = jobs({
      runtime: inngest({
        appId: "farm-app",
        eventKey: "evt_test_key",
        signingKey: "sign_test_key",
      }),
      tasks,
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const triggerResult = await api.jobs.importCsv.trigger({
      body: {
        fileId: "file_1",
      },
    });

    expect(triggerResult.error).toBeNull();
    expect(triggerResult.data).toMatchObject({
      handleId: "evt_123",
      task: "importCsv",
      runtime: "inngest",
      providerTaskId: "farm/import-csv",
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "https://inn.gs/e/evt_test_key",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(
      JSON.parse(
        String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0][1] as RequestInit).body),
      ),
    ).toEqual({
      name: "farm/import-csv",
      data: {
        fileId: "file_1",
      },
      id: "import:file_1",
    });

    const statusResult = await api.jobs.importCsv.status({
      query: {
        handleId: "evt_123",
      },
    });

    expect(statusResult.error).toBeNull();
    expect(statusResult.data).toEqual({
      handleId: "evt_123",
      providerRunId: "run_ing_123",
      task: "importCsv",
      runtime: "inngest",
      status: "completed",
      providerStatus: "Completed",
      queuedAt: "2026-04-15T09:00:00.000Z",
      startedAt: "2026-04-15T09:00:00.000Z",
      finishedAt: "2026-04-15T09:01:00.000Z",
      output: {
        processed: 6,
      },
      error: null,
      tags: [],
      raw: {
        data: [
          {
            run_id: "run_ing_123",
            status: "Completed",
            run_started_at: "2026-04-15T09:00:00.000Z",
            ended_at: "2026-04-15T09:01:00.000Z",
            output: {
              processed: 6,
            },
          },
        ],
      },
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://api.inngest.com/v1/events/evt_123/runs",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          authorization: "Bearer sign_test_key",
        }),
      }),
    );
  });

  it("batch triggers Inngest events for fan-out imports", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      jsonResponse({
        ids: ["evt_1", "evt_2", "evt_3"],
        status: 200,
      }),
    );

    const integration = jobs({
      runtime: inngest({
        eventKey: "evt_test_key",
        signingKey: "sign_test_key",
      }),
      tasks: defineTasks({
        importCsv: task({
          defaults: {
            idempotencyKey(input: { fileId: string }) {
              return `import:${input.fileId}`;
            },
          },
          async run(input: { fileId: string }) {
            return {
              processed: input.fileId.length,
            };
          },
        }),
      }),
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const result = await api.jobs.importCsv.batchTrigger({
      body: {
        items: [
          {
            fileId: "file_1",
          },
          {
            fileId: "file_2",
          },
          {
            fileId: "file_3",
          },
        ],
      },
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({
      batchId: null,
      task: "importCsv",
      runtime: "inngest",
      providerTaskId: "farm/import-csv",
      runs: [
        {
          index: 0,
          handleId: "evt_1",
          queuedAt: expect.any(String),
        },
        {
          index: 1,
          handleId: "evt_2",
          queuedAt: expect.any(String),
        },
        {
          index: 2,
          handleId: "evt_3",
          queuedAt: expect.any(String),
        },
      ],
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://inn.gs/e/evt_test_key",
      expect.objectContaining({
        method: "POST",
      }),
    );
    expect(
      JSON.parse(
        String(fetchSpy.mock.calls[0]?.[1] && (fetchSpy.mock.calls[0][1] as RequestInit).body),
      ),
    ).toEqual([
      {
        name: "farm/import-csv",
        data: {
          fileId: "file_1",
        },
        id: "import:file_1",
      },
      {
        name: "farm/import-csv",
        data: {
          fileId: "file_2",
        },
        id: "import:file_2",
      },
      {
        name: "farm/import-csv",
        data: {
          fileId: "file_3",
        },
        id: "import:file_3",
      },
    ]);
  });

  it("rejects Trigger-only launch options when using the Inngest runtime", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const integration = jobs({
      runtime: inngest({
        eventKey: "evt_test_key",
        signingKey: "sign_test_key",
      }),
      tasks: defineTasks({
        importCsv: task({
          async run(input: { fileId: string }) {
            return {
              processed: input.fileId.length,
            };
          },
        }),
      }),
    });
    const api = createIntegrationServerClient(
      {
        integrations: {
          jobs: integration,
        },
      },
      {
        request: new Request("https://farmjs.dev/jobs"),
      },
    );

    const result = await api.jobs.importCsv.trigger({
      body: {
        fileId: "file_1",
        $options: {
          debounce: {
            key: "import:file_1",
            delay: "30s",
          },
        },
      },
    });

    expect(result.data).toBeNull();
    expect(result.error?.message).toContain(
      "Inngest runtime does not support delay, debounce, or tags through this integration yet.",
    );

    const scheduled = await api.jobs.importCsv.schedule({
      body: {
        fileId: "file_1",
        $schedule: {
          after: "5m",
        },
      },
    });

    expect(scheduled.data).toBeNull();
    expect(scheduled.error?.message).toContain(
      "Inngest runtime does not support delay, debounce, or tags through this integration yet.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
