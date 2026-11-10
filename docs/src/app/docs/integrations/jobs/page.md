---
title: "Jobs Integration"
description: "Define typed job contracts once, then run them in your app with local(), on Trigger.dev or Inngest, or on a runtime you write."
section: "Integrations"
---

# Jobs Integration

The Jobs integration gives a Farm app typed trigger, batch, status, scheduling, cancellation, and metadata routes. One task map works with every runtime; the runtime decides who runs the work:

| Runtime                  | Who runs the task                                                |
| ------------------------ | ---------------------------------------------------------------- |
| `local()`                | Your app. Farm calls `run` and keeps runs in Farm storage.       |
| `trigger(...)`           | Trigger.dev, with the task you deploy there.                     |
| `inngest(...)`           | Inngest, with the function you deploy there.                     |
| `defineJobsRuntime(...)` | Whatever you write: a queue, a database table, another provider. |

## Define the task contract

**src/lib/jobs.ts**

```ts
import { defineTasks, task } from "@farm.js/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    id: "send-welcome-email",
    description: "Send the first email after signup.",
    async run(input: { userId: string }) {
      return {
        messageId: `msg_${input.userId}`,
      };
    },
  }),
});
```

The object key, `id`, and `run` return type have different jobs:

| Field                         | Purpose                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `sendWelcomeEmail` object key | Creates the `api.jobs.sendWelcomeEmail` caller namespace.                             |
| `id`                          | Selects the provider-side task or event name. Defaults to the kebab-cased object key. |
| `run` input                   | Infers the typed trigger payload.                                                     |
| `run` return value            | Infers the typed `status().data.output` value.                                        |

**Important:** Trigger.dev and Inngest run the code you deploy to them, not this `run` callback. With those runtimes, create matching provider-side code and keep its input and output in step with this definition. `local()`, and any runtime that calls `context.execute`, runs this callback.

Provider identity is resolved as follows:

| Runtime     | Provider-side identity for the example |
| ----------- | -------------------------------------- |
| Trigger.dev | Task ID `send-welcome-email`           |
| Inngest     | Event name `farm/send-welcome-email`   |

Inngest's `farm` prefix can be changed with `eventNamePrefix`.

## Mount a runtime

**src/lib/integrations.ts**

```ts
import { jobs, trigger } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
    }),
    tasks,
  }),
} as const;

export type AppIntegrations = typeof appIntegrations;
```

Swap `trigger(...)` for `inngest(...)` to keep the same caller namespace with the Inngest runtime. Runtime capabilities are not identical, so check the matrix below before sharing task defaults.

The runtime definition is the jobs integration's injection boundary. Farm does not construct a
Trigger.dev or Inngest SDK instance in the application process; it calls the configured external
runtime over HTTP.

This means jobs have one clear ownership split: the application passes provider credentials and
endpoint options to `trigger(...)` or `inngest(...)`, Farm constructs the HTTP runtime adapter, and
the provider continues to own deployed tasks or functions. There is no in-process SDK `instance` to
inject.

## Run tasks in the app with `local()`

`local()` calls each task's `run` in your app. It needs no provider account, so it fits development,
tests, and apps that run as one long-lived server.

**src/lib/integrations.ts**

```ts
import { jobs, local } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({
    runtime: local(),
    tasks,
  }),
} as const;
```

A run starts right after the response that triggered it, through [`after()`](/docs/after). Delayed
runs, scheduled runs, and retries start when the runtime next looks for due runs: every second while
the server is up, and on every call to its tick route.

Runs are kept in the `jobs` [storage](/docs/storage) namespace. Farm's default store is in memory,
so a production build refuses to start a run until that namespace has a persistent driver:

**farm.config.ts**

```ts
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  storage: {
    mounts: {
      jobs: { driver: "local", base: ".data/jobs" },
    },
  },
});
```

Any KV driver works. Pass `local({ storage: "other-name" })` to use another namespace, or a storage
instance to skip the check.

### Serverless hosts and the tick route

A serverless function does not stay alive between requests, so nothing looks for due runs there.
Schedule the tick route with [Cron](/docs/cron):

**farm.config.ts**

```ts
export default defineConfig({
  cron: {
    jobsTick: {
      schedule: "* * * * *",
      path: "/api/jobs/_runtime/local/tick",
    },
  },
});
```

The tick route checks `CRON_SECRET` like any cron route, and accepts Farm.js Infra's signed calls
when `cron.provider` is `"farmjs"`. Without a secret it answers only in development and tests. It
returns what it did: `{ started, completed, failed, retried, expired, removed }`.

### Options

| Option           | Default                                | Meaning                                                                                      |
| ---------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `storage`        | `"jobs"`                               | A storage namespace name, or a storage instance.                                             |
| `pollIntervalMs` | `1000`                                 | How often a running server looks for due runs. `false` leaves it to the tick route.          |
| `leaseMs`        | `300000`                               | How long one attempt may run. After that its `signal` aborts and the run is attempted again. |
| `retryDelayMs`   | `1000 * 2 ** (n - 1)`, at most `60000` | The wait after attempt `n` fails. A number, or a function of `n`.                            |
| `retentionMs`    | `604800000` (7 days)                   | How long a finished run stays readable through `status`.                                     |
| `tickLimit`      | `25`                                   | Most runs one tick starts.                                                                   |

### What a task receives

`run(input, context)` receives `context.run` (`{ id, attempt }`), a `context.signal` that aborts when
the run is canceled or its lease ends, and `context.logger`. The return value is stored as JSON and
returned by `status` as `output`. A thrown error is stored as `{ name, message }`; the stack is not
kept.

Task defaults map like this:

- `retry: { attempts }` sets the number of attempts. The default is 3, and `retry: false` means 1.
- `ttl` expires a run that has not started in time, counted from when it is due. A number is seconds, as on Trigger.dev.
- `idempotencyKey` returns the existing run for a repeated key while that run is kept.
- `tags` are stored and returned by `status`.
- `queue` and `concurrencyKey` fail at setup, and per-call `debounce` answers `400`.

### Limits

- Delivery is at least once. If a process stops after a task finished but before its result was stored, the run is attempted again, so make tasks safe to repeat.
- In one process a run never executes twice at the same time. Storage has no atomic claim, so instances sharing storage can occasionally both start the same due run. Use a provider runtime for work that must run once across instances.
- The runs one tick starts go one after another, so a slow task delays the rest of that tick. Runs started by `after()` don't wait for each other.
- There is no queue or concurrency limit.

## Create callers

```ts
import { createIntegrations } from "@farm.js/core/client";
import type { AppIntegrations } from "./integrations";

export const { api, apiClient } = createIntegrations<AppIntegrations>();
```

Use `api` in trusted server code. Job routes start provider runs with the app's credentials, so
by default they answer only these in-process server calls: an HTTP request, including `apiClient`
in the browser, gets `403`.

To let HTTP callers in, pass `authorize`. It receives a copy of the request, so it can read the
body, plus the task key (`null` for the task list) and the operation. Return `true` to allow the
request, `{ caller }` to allow it and name who sent it, `false` to answer `403`, or a `Response`
to answer with:

```ts
import { getSession } from "./auth";

export const appIntegrations = {
  jobs: jobs({
    runtime: trigger({
      apiKey: process.env.TRIGGER_SECRET_KEY,
      projectRef: process.env.TRIGGER_PROJECT_REF,
    }),
    tasks,
    async authorize(request, { task, operation }) {
      const session = await getSession(request);
      if (!session) return new Response("Sign in first", { status: 401 });
      if (task !== "sendWelcomeEmail" || operation !== "trigger") return false;
      return { caller: session.userId };
    },
  }),
} as const;
```

`status` and `cancel` take any handle ID the caller sends, so check that the run belongs to the
caller before allowing them. A task's `status` and `cancel` routes only act on that task's own
runs (Trigger.dev) or events (Inngest).

An HTTP caller's `idempotencyKey` cannot claim anyone else's key. The task's own
`defaults.idempotencyKey` wins over it, and a key the caller picks is namespaced to the task and to
the `caller` that `authorize` returned, as `farm-http:<task id>:<caller>:<key>`. Without a named
caller, every HTTP caller of a task shares one namespace. Keys passed by server code through `api`
are used as given.

## Trigger one run

Task input is placed directly in `body`. Farm-specific launch options live under `$options`.

```ts
const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: {
    userId: "usr_123",
    $options: {
      idempotencyKey: "welcome:usr_123",
      tags: ["signup"],
    },
  },
});

const handleId = queued.data!.handleId;
```

When a task takes a scalar input rather than an object, wrap it in `$value` so it stays distinguishable from inline payload fields:

```ts
const queued = await api.jobs.countTokens.trigger({
  body: {
    $value: 42,
    $options: { tags: ["billing"] },
  },
});
```

Reserved keys are `$`-prefixed (`$value`, `$input`, `$options`, `$schedule`), so an object input is free to use ordinary field names such as `value` or `input` without colliding with the envelope. `$value` is read as the scalar wrapper only when it is the sole payload key; an object that carries other fields is delivered whole. An empty object body delivers `{}`, and a task whose input is an array can send the array as the whole body (or as a batch item).

The older `{ input, options }` body is still accepted but is **deprecated**. The inline shape above,
with `$input` for collision-prone object inputs, is the canonical API.

If the task input itself has an `input` field, use the explicit `$input` envelope so Farm does not
confuse the payload with that legacy trigger format:

```ts
await api.jobs.storeCount.trigger({
  body: {
    $input: { input: 5 },
  },
});
```

The same explicit form works for `schedule` (alongside `$schedule`) and for each item in a batch.

### The deprecated `{ input, options }` envelope

The legacy envelope still works, and will keep working for the whole `0.x` line, but it cannot be
made unambiguous. A body whose only keys are `input` and `options` is read as the envelope, so an
object input that carries its own `input` field is unwrapped into that field's value instead of being
delivered whole:

```ts
// Deprecated. Read as the envelope, so the task receives "digest", not { input: "digest" }.
await api.jobs.sendDigest.trigger({ body: { input: "digest" } });

// Canonical. The $ prefix is reserved, so this cannot collide with payload data.
await api.jobs.sendDigest.trigger({ body: { $input: { input: "digest" } } });
```

A development build logs a one-time warning per operation when a request arrives in the legacy shape.
The warning names the shape and the replacement and never includes any part of the body, because a job
payload can carry user data. Production builds stay silent.

`trigger`, `schedule`, and every item in a `batchTrigger` follow the same policy.

### Migrating during a rolling deploy

`$input` is understood only by consumers running this version or later. An older consumer does not
treat `$input` as reserved, so it delivers `{ $input: ... }` to the task as an ordinary payload field
and the task sees the wrapper instead of its input.

**Update every consumer before any producer starts sending `$input`.**

| Producer sends                           | Consumer before `$input`         | Consumer on this version                   |
| ---------------------------------------- | -------------------------------- | ------------------------------------------ |
| `{ input, options }`                     | Works                            | Works, logs a development warning          |
| Inline object, no reserved keys          | Works                            | Works                                      |
| Inline object with its own `input` field | Unwrapped as the envelope        | Unwrapped as the envelope, so use `$input` |
| `{ $input, $options }`                   | **Delivered as a payload field** | Works                                      |

The third row is the reason for the deprecation: it is wrong on both sides of the deploy, and `$input`
is the only form that fixes it. The fourth row is the reason for the ordering rule.

Removal is not scheduled within `0.x`. The earliest candidate is the first release after `1.0`, which
will be announced before it lands.

## Batch trigger

```ts
const batch = await api.jobs.sendWelcomeEmail.batchTrigger({
  body: {
    items: [
      {
        userId: "usr_123",
        $options: {
          idempotencyKey: "welcome:usr_123",
        },
      },
      {
        userId: "usr_456",
        $options: {
          idempotencyKey: "welcome:usr_456",
        },
      },
    ],
  },
});
```

Each result contains an index, provider handle ID, and queue timestamp. Trigger.dev can also return a provider batch ID; Inngest returns `batchId: null`.

## Read status

```ts
const result = await api.jobs.sendWelcomeEmail.status({
  query: {
    handleId,
  },
});

if (result.data?.status === "completed") {
  console.log(result.data.output?.messageId);
}
```

Farm normalizes provider states to `queued`, `delayed`, `running`, `waiting`, `completed`, `failed`, `canceled`, `expired`, or `unknown`. The raw provider response remains available as `data.raw`.

## Schedule and cancel

One-off scheduling requires exactly one of `at` or `after`:

```ts
await api.jobs.sendWelcomeEmail.schedule({
  body: {
    userId: "usr_123",
    $schedule: {
      after: "10m",
      idempotencyKey: "welcome:usr_123",
      tags: ["scheduled"],
    },
  },
});
```

`$options` launch options (`idempotencyKey`, `tags`, `debounce`) also apply to a schedule. Tags from both are combined, and a value set on `$schedule` wins over the same `$options` field. `$schedule` alone sets the timing.

```ts
await api.jobs.sendWelcomeEmail.cancel({
  body: {
    handleId,
  },
});
```

These callers exist in the shared API for every runtime. Trigger.dev and `local()` support one-off scheduling and cancellation. Inngest supports one-off scheduling by mapping the requested time to the event `ts`, but cancellation remains unsupported and returns `501`.

For Inngest, `at` must be an ISO timestamp with an explicit `Z` or UTC offset. `after` accepts a positive number of milliseconds or a duration ending in `ms`, `s`, `m`, `h`, or `d`. The same formats apply to `$options.delay`: an ISO timestamp is absolute and a number or duration is relative. Farm rejects invalid or past absolute times before contacting Inngest.

Inngest uses `idempotencyKey` as the event `id`. Per-call debounce cannot be represented by an event send; configure [debounce on the Inngest function](https://www.inngest.com/docs/guides/debounce) instead. Farm tags are also unsupported by Inngest event sends. Check `task.capabilities` or use the typed guard before exposing provider-dependent controls:

```ts
import { supportsJobsRuntimeCapability } from "@farm.js/jobs";

if (supportsJobsRuntimeCapability(task.capabilities, "schedule")) {
  // Show or call provider-backed scheduling controls.
}
```

Inngest documents future event timestamps as scheduling new matching function runs. A function already waiting for that event resumes immediately rather than waiting for the future timestamp. See the [event send reference](https://www.inngest.com/docs/reference/typescript/v3/events/send) for that provider behavior.

The `schedule` field on `task({...})`, including cron and timezone, is exposed as metadata only. It does not create a provider schedule.

## Task defaults

```ts
task({
  defaults: {
    queue: {
      name: "email",
      concurrencyLimit: 2,
    },
    retry: {
      attempts: 3,
    },
    ttl: "10m",
    tags: ["email"],
    concurrencyKey(input: { userId: string }) {
      return `user:${input.userId}`;
    },
    idempotencyKey(input: { userId: string }) {
      return `welcome:${input.userId}`;
    },
  },
  async run(input: { userId: string }) {
    return { messageId: input.userId };
  },
});
```

Trigger.dev maps all of these defaults into launch options. Inngest accepts `idempotencyKey`; one-off timing is supplied per call through `schedule` or `$options.delay`. `local()` honors `retry`, `ttl`, `tags`, and `idempotencyKey`. A default the selected runtime cannot honor causes integration setup to fail.

## Runtime capabilities

| Capability                        | Trigger.dev   | Inngest                   | `local()`             |
| --------------------------------- | ------------- | ------------------------- | --------------------- |
| Runs `run` from this task map     | No            | No                        | Yes                   |
| Trigger one run                   | Yes           | Yes                       | Yes                   |
| Batch trigger                     | Yes           | Yes                       | Yes, one run per item |
| Status polling                    | Yes           | Yes                       | Yes                   |
| Idempotency key                   | Yes           | Yes, sent as the event ID | Yes                   |
| Delay and one-off schedule        | Yes           | Yes, via the event `ts`   | Yes                   |
| Debounce and tags                 | Yes           | No                        | Tags only             |
| Queue and retry defaults          | Yes           | No                        | Retry only            |
| TTL and concurrency key           | Yes           | No                        | TTL only              |
| Cancel                            | Yes           | No                        | Yes                   |
| Cron `task.schedule` registration | Metadata only | Metadata only             | Metadata only         |

## Write a runtime

A runtime is a `kind`, the capabilities it honors, and a few functions. Make one with
`defineJobsRuntime()` and pass it as `jobs({ runtime })`:

**src/lib/my-queue.ts**

```ts
import { defineJobsRuntime, JobsRuntimeError } from "@farm.js/jobs";

export function myQueue(options: { url: string; token: string }) {
  const headers = { authorization: `Bearer ${options.token}`, "content-type": "application/json" };

  return defineJobsRuntime({
    kind: "my-queue",
    create() {
      return {
        capabilities: {
          delay: true,
          schedule: true,
          debounce: false,
          tags: false,
          cancel: true,
          batchTrigger: true,
          queue: false,
          retry: false,
          ttl: false,
          concurrencyKey: false,
          idempotencyKey: true,
        },
        async trigger(task, input, launch) {
          const response = await fetch(`${options.url}/jobs`, {
            method: "POST",
            headers,
            body: JSON.stringify({ name: task.remoteId, input, key: launch.idempotencyKey }),
          });
          const job = (await response.json()) as { id: string };
          return { handleId: job.id };
        },
        async status(task, handleId) {
          const response = await fetch(`${options.url}/jobs/${handleId}`, { headers });
          const job = (await response.json()) as { name: string; state: "queued" | "completed" };
          // Answer only for this task's runs.
          if (job.name !== task.remoteId) {
            throw new JobsRuntimeError(
              `Run ${handleId} was not found for task "${task.key}".`,
              404,
            );
          }
          return { status: job.state };
        },
        async cancel(_task, handleId) {
          await fetch(`${options.url}/jobs/${handleId}`, { method: "DELETE", headers });
        },
      };
    },
  });
}
```

Farm does the shared work, so a runtime does not repeat it:

- It refuses any option whose capability is `false`: task defaults at setup, and per-call options with `400` (`501` for `schedule`, `batchTrigger`, and `cancel`). The error carries `details.code: "JOBS_RUNTIME_CAPABILITY_UNSUPPORTED"` and the capability.
- It merges task defaults with call options, and namespaces an HTTP caller's idempotency key, before `trigger` sees them.
- Without `batchTrigger`, a batch triggers each item in order. If one fails, the error's `details.runs` lists the runs that already started.
- It fills `status` fields the runtime leaves out with `null` or `[]`, and reports a status it does not know as `unknown`.

A runtime that runs tasks itself calls `context.execute({ task, input, run, signal })`. Farm calls
the task's `run` with its context and returns `{ ok: true, output }` or `{ ok: false, error }`.

A runtime can mount its own routes, such as a tick or a provider webhook. They live at
`<basePath>/_runtime/<kind>/<path>`, and every route needs `verify`, because schedulers and
providers call them rather than your users: `true` lets the request through, `false` answers
`401`, and a `Response` is sent as is.

`create()` runs whenever the app loads its integrations, including during `farm build`, so keep it
cheap. Start timers or open connections in `start()`, which runs when the server starts, and stop
them in `dispose()`, which runs at shutdown.

`kind` is lowercase letters, digits, and dashes, and `trigger` and `inngest` are taken. Results
report it as `runtime`, typed as the literal you passed. A runtime records the contract version it
was built for, `JOBS_RUNTIME_CONTRACT`, and `jobs()` refuses one built for another version.

### Test a runtime

`@farm.js/jobs/testing` holds the checks every runtime must pass, as plain cases for any test
runner:

**src/lib/my-queue.test.ts**

```ts
import { createJobsRuntimeConformance } from "@farm.js/jobs/testing";
import { describe, it } from "vitest";
import { myQueue } from "./my-queue";

describe("my-queue runtime", () => {
  for (const conformance of createJobsRuntimeConformance({
    runtime: () => myQueue({ url: "http://localhost:4000", token: "test" }),
  })) {
    it(conformance.name, conformance.run);
  }
});
```

Pass `drive` as well to check that runs complete and failures are reported. It should make started
runs execute, for example by calling the runtime's tick route. Farm runs this suite against
`local()` in its own tests.

## Generated routes

For the `sendWelcomeEmail` key and default `basePath`, Farm mounts:

| Method | Route                                              |
| ------ | -------------------------------------------------- |
| `GET`  | `/api/jobs/tasks`                                  |
| `POST` | `/api/jobs/send-welcome-email/trigger`             |
| `POST` | `/api/jobs/send-welcome-email/batch-trigger`       |
| `POST` | `/api/jobs/send-welcome-email/schedule`            |
| `GET`  | `/api/jobs/send-welcome-email/status?handleId=...` |
| `POST` | `/api/jobs/send-welcome-email/cancel`              |
| `GET`  | `/api/jobs/_runtime/local/tick` (`local()` only)   |

Read task IDs, provider IDs, paths, defaults, configuration state, and runtime capabilities with:

```ts
const metadata = await api.jobs.tasks.list();
```

Change the route prefix with `jobs({ basePath: "/api/automation", ... })`.

## Production checklist

- With Trigger.dev or Inngest, implement and deploy the matching provider task or event function.
- With `local()`, give the `jobs` storage namespace a persistent driver, make tasks safe to repeat, and schedule the tick route on serverless hosts.
- Keep object keys and provider IDs stable.
- Keep job routes server-only, or allow HTTP callers with `authorize` and check who they are.
- Use idempotency keys for user-retriable actions.
- Persist handle IDs when a later request needs status or cancellation.
- Verify each option against the selected runtime capability matrix.
