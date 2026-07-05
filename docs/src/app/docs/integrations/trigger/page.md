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
await api.jobs.trigger.post({
  body: { task: "send-welcome-email", input: { userId: "user_123" } },
});
```
