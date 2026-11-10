# Jobs Integration Example

This example shows the `jobs({...})` integration with three runtime helpers:

- `runtime: local()` runs each task's `run` in this app
- `runtime: trigger({ ... })` for Trigger.dev
- `runtime: inngest({ ... })` for Inngest

Set `JOBS_RUNTIME=local`, `JOBS_RUNTIME=trigger`, or `JOBS_RUNTIME=inngest` in `.env.local` to
switch which one is mounted by [integrations.ts](./src/lib/integrations.ts). Set it for both
`farm build` and the server, because [farm.config.ts](./farm.config.ts) reads it too.

Local env:

```sh
JOBS_RUNTIME=local
# Guards /api/jobs/_runtime/local/tick outside development.
CRON_SECRET=...
```

With `local()`, runs are kept in `.data/jobs` through the `jobs` storage mount in
`farm.config.ts`. A production build refuses the in-memory default, because a restart would lose
its runs.

Trigger.dev env:

```sh
JOBS_RUNTIME=trigger
TRIGGER_SECRET_KEY=tr_dev_...
TRIGGER_PROJECT_REF=proj_...
TRIGGER_WEBHOOK_SECRET=whsec_...
```

Inngest env:

```sh
JOBS_RUNTIME=inngest
INNGEST_APP_ID=farm-jobs-example
INNGEST_EVENT_KEY=evt_...
INNGEST_SIGNING_KEY=signkey_...
```

The task definitions live in [jobs.ts](./src/lib/jobs.ts),
and the server caller lives in [api.server.ts](./src/lib/api.server.ts).

Typical server-side usage:

```ts
const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: {
      delay: "10m",
      tags: ["signup"],
    },
  },
});

const status = await api.jobs.sendWelcomeEmail.status({
  query: { handleId: queued.data!.handleId },
});
```

One-off scheduling is explicit:

```ts
const scheduled = await api.jobs.sendWelcomeEmail.schedule({
  body: {
    userId: "usr_123",
    $schedule: {
      after: "10m",
      tags: ["signup", "scheduled"],
    },
  },
});
```

For Inngest the `handleId` is the event ID, so status polling uses that event handle:

```ts
const queued = await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
  },
});

const status = await api.jobs.importCsv.status({
  query: { handleId: queued.data!.handleId },
});
```
