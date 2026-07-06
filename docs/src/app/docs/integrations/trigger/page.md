---
title: "Trigger.dev Integration"
description: "Run Farm tasks through Trigger.dev with typed trigger, status, and cancel APIs."
section: "Integrations"
---

# Trigger.dev Integration

Trigger.dev is the workflow runtime for long-running background jobs, retries, schedules, queues, and production task observability.

## Add Trigger.dev

**Terminal**

```bash
farm add integration jobs-trigger --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { jobs, trigger } from "@farmjs/integrations/jobs";
import { tasks } from "./jobs";

export const integrations = {
  jobs: jobs({
    tasks,
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
    }),
  }),
};
```

## Use it

**Caller**

```ts
await api.jobs.sendWelcomeEmail.trigger({
  body: {
    input: {
      userId: "user_123",
    },
  },
});
```

## Farm task mapping

Trigger.dev is mounted through the Jobs integration. Define tasks once with `defineTasks`, then choose `trigger(...)` as the runtime.

```ts
export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    async run(input: { userId: string }) {
      return {
        sent: true,
        userId: input.userId,
      };
    },
  }),
});
```

Farm turns `sendWelcomeEmail` into typed callers such as:

```ts
await api.jobs.sendWelcomeEmail.trigger({
  body: {
    input: {
      userId: "user_123",
    },
  },
});

await api.jobs.sendWelcomeEmail.status({
  query: {
    handleId: "run_123",
  },
});
```

## Production notes

- Set the Trigger.dev secret/project config required by your runtime.
- Use queues and retry defaults on the task definition for predictable load.
- Keep task IDs stable because provider dashboards and Farm callers depend on them.
- Store returned `handleId` when users need status polling.
- Use batch trigger for bulk work instead of loops from the browser.
