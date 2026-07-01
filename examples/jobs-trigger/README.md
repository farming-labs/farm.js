# Trigger Jobs Example

This example mounts the Farm `jobs({...})` integration against the Trigger.dev runtime.

Expected env:

```sh
TRIGGER_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_REF=proj_...
TRIGGER_WEBHOOK_SECRET=whsec_... # optional for now
```

For the current example flow, `TRIGGER_SECRET_KEY` is the credential used to enqueue and poll runs.
`TRIGGER_PROJECT_REF` is forwarded as request context metadata, and `TRIGGER_WEBHOOK_SECRET`
is reserved for future callback/webhook support.

The integration config lives in [integrations.ts](/Users/mac/oss/farm.js/examples/jobs-trigger/src/lib/integrations.ts),
the task definitions live in [jobs.ts](/Users/mac/oss/farm.js/examples/jobs-trigger/src/lib/jobs.ts),
and the callers are split between [api.server.ts](/Users/mac/oss/farm.js/examples/jobs-trigger/src/lib/api.server.ts)
and [api.client.ts](/Users/mac/oss/farm.js/examples/jobs-trigger/src/lib/api.client.ts).

The page includes a small client probe that:

- schedules `farmjsSanityCheck` with `api.jobs.farmjsSanityCheck.schedule(...)`
- batch triggers multiple `farmjsSanityCheck` runs
- stores the returned handle id
- polls `api.jobs.farmjsSanityCheck.status(...)`

Server-side usage:

```ts
const queued = await api.jobs.farmjsSanityCheck.trigger({
  body: {
    ping: true,
    $options: {
      debounce: {
        key: "sanity-browser",
        delay: "15s",
      },
      tags: ["demo"],
    },
  },
});

const scheduled = await api.jobs.farmjsSanityCheck.schedule({
  body: {
    ping: true,
    $schedule: {
      after: "1m",
      tags: ["scheduled"],
    },
  },
});

const batch = await api.jobs.farmjsSanityCheck.batchTrigger({
  body: {
    items: [
      { ping: true, $options: { idempotencyKey: "sanity:1" } },
      { ping: true, $options: { idempotencyKey: "sanity:2" } },
    ],
  },
});

const status = await api.jobs.farmjsSanityCheck.status({
  query: { handleId: scheduled.data!.handleId },
});
```
