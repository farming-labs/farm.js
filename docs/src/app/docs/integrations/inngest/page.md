---
title: "Inngest Integration"
description: "Send typed events to existing Inngest functions, batch them, and inspect runs from Farm."
section: "Integrations"
---

# Inngest Integration

The Inngest runtime turns each Farm task into an event name, sends single or batched events, and reads function runs by the returned event ID.

The current adapter is intentionally narrower than the Trigger.dev runtime. It supports triggering, batching, status, and idempotent event IDs. It does not currently expose delay, scheduling, cancellation, tags, queues, retries, TTL, or concurrency options.

## Add Inngest

**Terminal**

```bash
farm add integration jobs-inngest --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { inngest, jobs } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: inngest({
      appId: process.env.INNGEST_APP_ID,
      eventKey: process.env.INNGEST_EVENT_KEY,
      signingKey: process.env.INNGEST_SIGNING_KEY,
    }),
    tasks,
  }),
} as const;
```

## Runtime ownership

Pass Inngest credentials and endpoint configuration to `inngest(...)`; Farm constructs the HTTP
runtime adapter and sends events to existing provider functions. Inngest continues to own function
registration and execution. There is no in-process Inngest SDK instance to inject into Farm.

## Environment variables

| Variable              | Current use                                                    |
| --------------------- | -------------------------------------------------------------- |
| `INNGEST_EVENT_KEY`   | Required to send single and batch events.                      |
| `INNGEST_SIGNING_KEY` | Required to look up runs for an event ID.                      |
| `INNGEST_APP_ID`      | Optional app identifier recorded in integration configuration. |

The runtime is reported as configured only when both event and signing keys are available.

## Match the provider function

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farm.js/jobs";

export const tasks = defineTasks({
  importCsv: task({
    id: "import-csv",
    description: "Import one uploaded CSV file.",
    defaults: {
      idempotencyKey(input: { fileId: string }) {
        return `import:${input.fileId}`;
      },
    },
    async run(input: { fileId: string }) {
      return {
        processed: input.fileId.length,
      };
    },
  }),
});
```

With the default prefix, Farm sends this event:

```text
farm/import-csv
```

Deploy an Inngest function that listens for that exact event name. The event payload is placed in `event.data`, and the computed idempotency key is sent as the event `id`. The typed status caller treats provider output as the local `run` return type without runtime validation.

The local `run` callback supplies TypeScript input/output inference. Farm does not execute or register it as an Inngest function.

## Change the event prefix

```ts
inngest({
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
  eventNamePrefix: "acme",
});
```

The same task now sends `acme/import-csv`.

## Trigger one event

```ts
const result = await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
  },
});
```

The returned `handleId` is Inngest's event ID, not a run ID. Farm uses it to ask Inngest for associated function runs.

An explicit per-call idempotency key is also supported:

```ts
await api.jobs.importCsv.trigger({
  body: {
    fileId: "file_123",
    $options: {
      idempotencyKey: "import:file_123:v2",
    },
  },
});
```

## Batch events

```ts
const batch = await api.jobs.importCsv.batchTrigger({
  body: {
    items: [{ fileId: "file_123" }, { fileId: "file_456" }, { fileId: "file_789" }],
  },
});
```

Farm sends the event array to the Inngest ingestion endpoint. The result contains one handle per accepted event and `batchId: null`.

## Read status

```ts
const status = await api.jobs.importCsv.status({
  query: {
    handleId: result.data!.handleId,
  },
});
```

If Inngest has accepted the event but no function run is visible yet, Farm returns normalized status `queued` with provider status `EVENT_ACCEPTED`. Once a run exists, the result includes its run ID, normalized state, timestamps, output, error, and raw response.

## Current limitations

The shared Jobs API still contains `schedule` and `cancel`, but the Inngest adapter reports unsupported behavior instead of silently ignoring it:

| Operation or option             | Current result                                  |
| ------------------------------- | ----------------------------------------------- |
| `$options.delay`                | `400`                                           |
| `$options.debounce`             | `400`                                           |
| `$options.tags`                 | `400`                                           |
| `api.jobs.<task>.schedule(...)` | `400` because delayed launch is not implemented |
| `api.jobs.<task>.cancel(...)`   | `501`                                           |
| `defaults.queue`                | Integration setup error                         |
| `defaults.retry`                | Integration setup error                         |
| `defaults.ttl`                  | Integration setup error                         |
| `defaults.concurrencyKey`       | Integration setup error                         |
| `defaults.tags`                 | Integration setup error                         |

`defaults.idempotencyKey` and batch triggering are supported.

A cron-shaped `schedule` field on the task is exposed in metadata only. It does not register an Inngest cron function.

## Custom endpoints

The defaults are `https://inn.gs` for event ingestion and `https://api.inngest.com` for run status:

```ts
inngest({
  eventKey: process.env.INNGEST_EVENT_KEY,
  signingKey: process.env.INNGEST_SIGNING_KEY,
  eventBaseUrl: "https://inngest-ingest.example.com",
  apiBaseUrl: "https://inngest-api.example.com",
});
```

Use these options for compatible proxies, test services, or supported self-hosted endpoints.

## Production checklist

- Deploy a function for every generated event name.
- Keep task IDs and `eventNamePrefix` stable.
- Use deterministic idempotency keys for retryable product events.
- Store the event handle when a later request needs status.
- Restrict job routes to trusted users or server code.
- Do not add Trigger-only defaults to tasks mounted with Inngest.
