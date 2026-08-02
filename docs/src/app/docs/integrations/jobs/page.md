---
title: "Jobs Integration"
description: "Define typed job contracts and call existing Trigger.dev tasks or Inngest functions through one Farm API."
section: "Integrations"
---

# Jobs Integration

The Jobs integration gives a Farm app typed trigger, batch, status, scheduling, cancellation, and metadata routes over Trigger.dev or Inngest.

It is currently a control-plane adapter. Farm sends work to a task or function that already exists in the selected provider and reads provider status back.

## Define the task contract

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farm.js/integrations/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    description: "Send the first email after signup.",
    async run(input: { userId: string }) {
      return {
        messageId: `msg_${input.userId}`,
      };
    },
  }),
});
```

The object key, `id`, and `run` return type have different jobs:

| Field                         | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `sendWelcomeEmail` object key | Creates the `api.jobs.sendWelcomeEmail` caller namespace.                             |
| `id`                          | Selects the provider-side task or event name. Defaults to the kebab-cased object key. |
| `run` input                   | Infers the typed trigger payload.                                                     |
| `run` return value            | Infers the typed `status().data.output` value.                                        |

**Important:** the current adapter does not execute or deploy the local `run` callback. Create matching provider-side code and keep its input/output contract synchronized with this definition.

Provider identity is resolved as follows:

| Runtime     | Provider-side identity for the example |
| ----------- | -------------------------------------- |
| Trigger.dev | Task ID `send-welcome-email`           |
| Inngest     | Event name `farm/send-welcome-email`   |

Inngest's `farm` prefix can be changed with `eventNamePrefix`.

## Mount a runtime

**src/lib/integrations.ts**

```ts
import { jobs, trigger } from "@farm.js/integrations/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
    }),
    tasks,
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Swap `trigger(...)` for `inngest(...)` to keep the same caller namespace with the Inngest runtime. Runtime capabilities are not identical, so check the matrix below before sharing task defaults.

The runtime definition is the jobs integration's injection boundary. Farm does not construct a
Trigger.dev or Inngest SDK instance in the application process; it calls the configured external
runtime over HTTP.

This means jobs have one clear ownership split: the application passes provider credentials and
endpoint options to `trigger(...)` or `inngest(...)`, Farm constructs the HTTP runtime adapter, and
the provider continues to own deployed tasks or functions. There is no in-process SDK `instance` to
inject.

## Create callers

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

Use `api` in trusted server code. Only expose `apiClient` to the browser when the application has added its own authorization around job routes.

## Trigger one run

Task input is placed directly in `body`. Farm-specific launch options live under `$options`.

```ts
const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: {
      idempotencyKey: "welcome:usr_123",
      tags: ["signup"],
    },
  },
});

const handleId = queued.data!.handleId;
```

The older `{ input, options }` body is still accepted, but the inline shape above is the canonical API.

## Batch trigger

```ts
const batch = await api.jobs.sendWelcomeEmail.batchTrigger({
  body: {
    items: [
      {
        userId: "usr_123",
        $options: {
          idempotencyKey: "welcome:usr_123",
        },
      },
      {
        userId: "usr_456",
        $options: {
          idempotencyKey: "welcome:usr_456",
        },
      },
    ],
  },
});
```

Each result contains an index, provider handle ID, and queue timestamp. Trigger.dev can also return a provider batch ID; Inngest returns `batchId: null`.

## Read status

```ts
const result = await api.jobs.sendWelcomeEmail.status({
  query: {
    handleId,
  },
});

if (result.data?.status === "completed") {
  console.log(result.data.output?.messageId);
}
```

Farm normalizes provider states to `queued`, `delayed`, `running`, `waiting`, `completed`, `failed`, `canceled`, `expired`, or `unknown`. The raw provider response remains available as `data.raw`.

## Schedule and cancel

One-off scheduling requires exactly one of `at` or `after`:

```ts
await api.jobs.sendWelcomeEmail.schedule({
  body: {
    userId: "usr_123",
    $schedule: {
      after: "10m",
      idempotencyKey: "welcome:usr_123",
      tags: ["scheduled"],
    },
  },
});
```

```ts
await api.jobs.sendWelcomeEmail.cancel({
  body: {
    handleId,
  },
});
```

These callers exist in the shared API for both runtimes, but the current Inngest adapter rejects one-off scheduling with `400` and cancellation with `501`. Trigger.dev supports both.

The `schedule` field on `task({...})`, including cron and timezone, is exposed as metadata only. It does not create a provider schedule.

## Task defaults

```ts
task({
  defaults: {
    queue: {
      name: "email",
      concurrencyLimit: 2,
    },
    retry: {
      attempts: 3,
    },
    ttl: "10m",
    tags: ["email"],
    concurrencyKey(input: { userId: string }) {
      return `user:${input.userId}`;
    },
    idempotencyKey(input: { userId: string }) {
      return `welcome:${input.userId}`;
    },
  },
  async run(input: { userId: string }) {
    return { messageId: input.userId };
  },
});
```

Trigger.dev maps all of these defaults into launch options. Inngest currently accepts only `idempotencyKey`; defining Trigger-only defaults causes integration setup to fail.

## Runtime capabilities

| Capability                        | Trigger.dev   | Inngest                   |
| --------------------------------- | ------------- | ------------------------- |
| Trigger one run                   | Yes           | Yes                       |
| Batch trigger                     | Yes           | Yes                       |
| Status polling                    | Yes           | Yes                       |
| Idempotency key                   | Yes           | Yes, sent as the event ID |
| Delay and one-off schedule        | Yes           | No                        |
| Debounce and tags                 | Yes           | No                        |
| Queue and retry defaults          | Yes           | No                        |
| TTL and concurrency key           | Yes           | No                        |
| Cancel                            | Yes           | No                        |
| Cron `task.schedule` registration | Metadata only | Metadata only             |

## Generated routes

For the `sendWelcomeEmail` key and default `basePath`, Farm mounts:

| Method | Route                                              |
| ------ | -------------------------------------------------- |
| `GET`  | `/api/jobs/tasks`                                  |
| `POST` | `/api/jobs/send-welcome-email/trigger`             |
| `POST` | `/api/jobs/send-welcome-email/batch-trigger`       |
| `POST` | `/api/jobs/send-welcome-email/schedule`            |
| `GET`  | `/api/jobs/send-welcome-email/status?handleId=...` |
| `POST` | `/api/jobs/send-welcome-email/cancel`              |

Read task IDs, provider IDs, paths, defaults, configuration state, and runtime capabilities with:

```ts
const metadata = await api.jobs.tasks.list();
```

Change the route prefix with `jobs({ basePath: "/api/automation", ... })`.

## Production checklist

- Implement and deploy the matching provider task or event function.
- Keep object keys and provider IDs stable.
- Restrict browser access to trigger, status, and cancel routes.
- Use idempotency keys for user-retriable actions.
- Persist handle IDs when a later request needs status or cancellation.
- Verify each option against the selected runtime capability matrix.
