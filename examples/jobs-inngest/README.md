# Inngest Jobs Example

This example mounts the Farm `jobs({...})` integration against the Inngest runtime.
It supports normal event triggering and batch fan-out. One-off scheduling through
`api.jobs.<task>.schedule(...)` is exposed by the shared Farm API, but this runtime reports it
as unsupported until the adapter grows delayed event support.

Expected env:

```sh
INNGEST_APP_ID=farm-jobs
INNGEST_EVENT_KEY=evt_...
INNGEST_SIGNING_KEY=signkey_...
```

The runtime-specific config lives in [integrations.ts](/Users/mac/oss/farm.js/examples/jobs-inngest/src/lib/integrations.ts),
the task definitions live in [jobs.ts](/Users/mac/oss/farm.js/examples/jobs-inngest/src/lib/jobs.ts),
and the callers are split between [api.server.ts](/Users/mac/oss/farm.js/examples/jobs-inngest/src/lib/api.server.ts)
and [api.client.ts](/Users/mac/oss/farm.js/examples/jobs-inngest/src/lib/api.client.ts).

Server-side usage:

```ts
const queued = await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
  },
});

const batch = await api.jobs.importCsv.batchTrigger({
  body: {
    items: [
      { fileId: "file_123" },
      { fileId: "file_124" },
    ],
  },
});

const status = await api.jobs.importCsv.status({
  query: { handleId: queued.data!.handleId },
});
```
