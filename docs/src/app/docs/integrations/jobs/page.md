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
      secretKey: process.env.TRIGGER_SECRET_KEY,
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
