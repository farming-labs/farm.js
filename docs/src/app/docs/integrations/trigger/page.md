---
title: "Trigger.dev Integration"
description: "Trigger, schedule, batch, inspect, and cancel existing Trigger.dev tasks through typed Farm callers."
section: "Integrations"
---

# Trigger.dev Integration

The Trigger.dev runtime maps Farm task contracts to existing Trigger.dev task IDs. It supports the complete Jobs integration surface: trigger, batch trigger, one-off scheduling, status, cancellation, queues, retries, TTL, tags, concurrency, idempotency, delay, and debounce.

Farm calls Trigger.dev over its HTTP API. It does not deploy the provider task.

## Add Trigger.dev

**Terminal**

```bash
farm add integration jobs-trigger --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { jobs, trigger } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
      webhookSecret: process.env.TRIGGER_WEBHOOK_SECRET,
    }),
    tasks,
  }),
} as const;
```

## Runtime ownership

Pass Trigger.dev credentials and endpoint configuration to `trigger(...)`; Farm constructs the HTTP
runtime adapter and calls the existing provider task. Trigger.dev continues to own task deployment
and execution. There is no in-process Trigger.dev SDK instance to inject into Farm.

## Environment variables

| Variable                 | Current use                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `TRIGGER_SECRET_KEY`     | Required to trigger, batch, read status, and cancel.                                         |
| `TRIGGER_PROJECT_REF`    | Optional project reference added to Farm's trigger request context.                          |
| `TRIGGER_WEBHOOK_SECRET` | Reserved in runtime config for future webhook support. It is not used by the current routes. |

`apiKey`, `projectRef`, and `webhookSecret` options override their matching environment variables.

## Match the provider task

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farm.js/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    description: "Send the first email after signup.",
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
```

Deploy a Trigger.dev task whose ID is exactly `send-welcome-email`. Farm sends the input as Trigger.dev's `payload` and adds source/task context. The typed status caller treats provider output as the local `run` return type, but Farm does not validate that output at runtime.

The local `run` callback supplies TypeScript input/output inference. The Farm integration route does not execute it.

## Trigger a run

```ts
const result = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: {
      delay: "30s",
      debounce: {
        key: "welcome:usr_123",
        delay: "10s",
      },
      tags: ["signup"],
    },
  },
});
```

Farm merges task defaults and per-call options before sending the request.

## Option mapping

| Farm definition or call                                | Trigger.dev launch option |
| ------------------------------------------------------ | ------------------------- |
| `defaults.queue`                                       | `queue`                   |
| `defaults.retry.attempts`                              | `maxAttempts`             |
| `defaults.ttl`                                         | `ttl`                     |
| `defaults.concurrencyKey`                              | `concurrencyKey`          |
| `defaults.idempotencyKey` or `$options.idempotencyKey` | `idempotencyKey`          |
| default and per-call tags                              | merged `tags`             |
| `$options.delay` or `$schedule` timing                 | `delay`                   |
| `$options.debounce`                                    | `debounce`                |

Per-call tags are deduplicated with default tags. A per-call idempotency key overrides the computed task default.

## One-off scheduling

Use `after` for a relative delay:

```ts
await api.jobs.sendWelcomeEmail.schedule({
  body: {
    userId: "usr_123",
    $schedule: {
      after: "10m",
      tags: ["scheduled"],
    },
  },
});
```

Or use `at` with an ISO date string or `Date`:

```ts
await api.jobs.sendWelcomeEmail.schedule({
  body: {
    userId: "usr_123",
    $schedule: {
      at: new Date("2026-08-01T09:00:00.000Z"),
    },
  },
});
```

Exactly one of `at` or `after` is required. Farm sends it through Trigger.dev's task trigger endpoint as `delay`.

A cron-shaped `schedule` on the task definition is metadata only and does not create a Trigger.dev schedule.

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

Farm calls Trigger.dev's task batch endpoint and returns `batchId` plus each run handle.

## Status and cancellation

```ts
const status = await api.jobs.sendWelcomeEmail.status({
  query: {
    handleId: result.data!.handleId,
  },
});

await api.jobs.sendWelcomeEmail.cancel({
  body: {
    handleId: result.data!.handleId,
  },
});
```

Status includes normalized and provider-native states, timestamps, output, error, tags, and the raw Trigger.dev response.

## Custom API endpoint

The default base is `https://api.trigger.dev`. Override it for a compatible proxy or test service:

```ts
trigger({
  apiKey: process.env.TRIGGER_SECRET_KEY,
  apiBaseUrl: "https://trigger-proxy.example.com",
});
```

## Production checklist

- Deploy a Trigger.dev task for every Farm task ID.
- Keep task IDs stable after callers ship.
- Store `handleId` when status or cancellation is needed later.
- Restrict job routes to trusted users or server code.
- Verify retry, queue, TTL, and concurrency behavior in the Trigger.dev dashboard.
- Treat `TRIGGER_WEBHOOK_SECRET` as reserved until webhook handling is implemented.
