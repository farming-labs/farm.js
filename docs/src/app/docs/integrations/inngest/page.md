---
title: "Inngest Integration"
description: "Run Farm tasks through Inngest with durable events, functions, and schedules."
section: "Integrations"
---

# Inngest Integration

Inngest is the event-driven workflow runtime for durable functions, retries, fan-out, schedules, and background app flows.

## Add Inngest

**Terminal**

```bash
farm add integration jobs-inngest --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { inngest, jobs } from "@farmjs/integrations/jobs";
import { tasks } from "./jobs";

export const integrations = {
  jobs: jobs({
    tasks,
    runtime: inngest({
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
    }),
  }),
};
```

## Use it

**Caller**

```ts
await api.jobs.syncCustomer.trigger({
  body: {
    input: {
      customerId: "cus_123",
    },
  },
});
```

## Farm task mapping

Inngest is mounted through the Jobs integration. Define tasks once, then choose `inngest(...)` as the runtime.

```ts
export const tasks = defineTasks({
  syncCustomer: task({
    id: "sync-customer",
    description: "Sync one customer after a billing event.",
    async run(input: { customerId: string }) {
      return {
        synced: true,
        customerId: input.customerId,
      };
    },
  }),
});
```

The app keeps the same Farm caller shape:

```ts
const run = await api.jobs.syncCustomer.trigger({
  body: {
    input: {
      customerId: "cus_123",
    },
  },
});

await api.jobs.syncCustomer.status({
  query: {
    handleId: run.data!.handleId,
  },
});
```

## Production notes

- Set `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY`.
- Prefer event-shaped task input when the workflow is driven by product events.
- Use retries for network/provider calls and idempotency for mutation-heavy jobs.
- Store handle IDs when the UI needs status reads.
- Test local development, signing, retries, and scheduled runs before shipping.
