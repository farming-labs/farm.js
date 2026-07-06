---
title: "Jobs Integration"
description: "Define typed tasks once and run them through Trigger.dev or Inngest with trigger, schedule, batch, status, and cancel APIs."
section: "Integrations"
---

# Jobs Integration

Define typed tasks once and run them through Trigger.dev or Inngest with trigger, schedule, batch, status, and cancel APIs.

## Define tasks

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farmjs/integrations/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    async run(input: { userId: string }, context) {
      context.logger.info("Sending welcome email", input);
      return { ok: true };
    },
  }),
});
```

## Mount a runtime

**src/lib/integrations.ts**

```ts
import { jobs, trigger } from "@farmjs/integrations/jobs";
import { tasks } from "./jobs";

export const integrations = {
  jobs: jobs({
    tasks,
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
    }),
  }),
};
```

## Trigger work

**Caller**

```ts
const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: { tags: ["signup"] },
  },
});

await api.jobs.sendWelcomeEmail.status({
  query: { handleId: queued.data!.handleId },
});
```

## What the jobs integration adds

| Area | Details |
| --- | --- |
| Metadata | A task list route for dashboards and debugging. |
| Trigger | Queue one task run with typed input. |
| Batch trigger | Queue many task runs at once. |
| Schedule | Queue work for a future time. |
| Status | Read the provider run state and typed output. |
| Cancel | Cancel a queued or running job when the runtime supports it. |

## Task options

```ts
export const tasks = defineTasks({
  syncCustomer: task({
    id: "sync-customer",
    description: "Sync customer data from the billing provider.",
    defaults: {
      queue: "billing",
      retry: {
        attempts: 3,
      },
      tags: ["billing"],
    },
    async run(input: { customerId: string }) {
      return {
        synced: true,
        customerId: input.customerId,
      };
    },
  }),
});
```

## Runtime choice

Use Trigger.dev when you want explicit job dashboards, task-oriented developer tooling, and production retry visibility. Use Inngest when the app is event-first and workflows naturally start from durable events.

The Farm caller shape stays the same either way:

```ts
await api.jobs.syncCustomer.trigger({
  body: {
    input: {
      customerId: "cus_123",
    },
    options: {
      tags: ["manual-sync"],
    },
  },
});
```

## Production notes

- Keep task keys stable because they become route and caller names.
- Use idempotency keys when user actions can submit the same job twice.
- Store provider handle IDs when the UI needs later status reads.
- Keep secrets in runtime config, not task input.
- Test trigger, status, cancellation, retry behavior, and scheduled runs.
