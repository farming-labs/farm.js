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
await api.jobs.trigger.post({
  body: { task: "sync-customer", input: { customerId: "cus_123" } },
});
```
