# @farm.js/jobs

Background jobs for Farm.js applications on Trigger.dev or Inngest. Tasks are declared once with
typed input and output, and the integration mounts routes to trigger, batch, schedule, check, and
cancel runs on the selected provider.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add @farm.js/jobs
```

The package has no provider SDK dependency: it calls the Trigger.dev and Inngest APIs over HTTP. To
scaffold the registry entry and a jobs console in an existing app, run
`farm add integration trigger --ui` or `farm add integration inngest --ui`.

## How it runs

Farm is the control plane. It starts runs of a task or function that already exists on the
provider and reads their status back. It does not execute or deploy the local `run` callback, so
deploy matching provider code and keep its input and output in step with the task definition.

A task's provider id is its `id`, or its key in kebab case, such as `send-welcome-email`.
Trigger.dev runs the task with that id. Inngest receives the event `farm/send-welcome-email`, and
`eventNamePrefix` changes the `farm` prefix.

## Configure

```ts
// src/lib/jobs.ts
import { defineTasks, task } from "@farm.js/jobs";

export const tasks = defineTasks({
  sendWelcomeEmail: task({
    defaults: { retry: { attempts: 3 }, tags: ["email"] },
    async run(input: { userId: string }) {
      return { messageId: `msg_${input.userId}` };
    },
  }),
});
```

```ts
// src/lib/integrations.ts
import { jobs, trigger } from "@farm.js/jobs";
import { tasks } from "./jobs";

export const appIntegrations = {
  jobs: jobs({ runtime: trigger({ apiKey: process.env.TRIGGER_SECRET_KEY }), tasks }),
} as const;
```

Use `runtime: inngest({ ... })` to run on Inngest instead. Settings fall back to the environment:

| Variable              | Purpose                                             |
| --------------------- | --------------------------------------------------- |
| `TRIGGER_SECRET_KEY`  | Trigger.dev key for triggering, status, and cancel. |
| `TRIGGER_PROJECT_REF` | Trigger.dev project reference, as `projectRef`.     |
| `INNGEST_EVENT_KEY`   | Sends Inngest events.                               |
| `INNGEST_SIGNING_KEY` | Reads Inngest run status.                           |
| `INNGEST_APP_ID`      | Inngest app id, as `appId`.                         |

`apiBaseUrl`, and `eventBaseUrl` on Inngest, point at another API host.

## Trigger and check runs

Server code calls the routes through `api` from `createIntegrations` in `@farm.js/core/client`.
Task input goes directly in `body`, and launch options go under `$options`. Use `$input` for the
input when it has its own `input` or `options` fields.

```ts
const queued = await api.jobs.sendWelcomeEmail.trigger({
  body: { userId: "usr_123", $options: { delay: "10m", tags: ["signup"] } },
});

const run = await api.jobs.sendWelcomeEmail.status({
  query: { handleId: queued.data!.handleId },
});

if (run.data?.status === "completed") console.log(run.data.output);
```

`schedule` takes `$schedule: { at }` or `$schedule: { after }`, `batchTrigger` takes `items`, and
`cancel` takes a `handleId`, so keep handle ids that later requests need.

## Routes and access

Each task mounts `trigger`, `batch-trigger`, `schedule`, `status`, and `cancel` under
`/api/jobs/<task>`, with the task key in kebab case. `GET /api/jobs/tasks` lists task metadata, and
`basePath` moves them all.

The routes answer only in-process server calls through `api` by default, and HTTP requests get
`403`. To let HTTP callers, such as `apiClient` in the browser, reach them, pass `authorize`:

```ts
jobs({
  runtime,
  tasks,
  async authorize(request) {
    const user = await getUser(request);
    return user ? { caller: user.id } : false;
  },
});
```

It also receives `{ task, operation }`. Return `true`, `{ caller }`, `false` for `403`, or a
`Response`. `status` and `cancel` accept any handle id, so check that the run belongs to the
caller. An HTTP caller's `idempotencyKey` is scoped to the task and the returned `caller`, and the
task's own `defaults.idempotencyKey` wins over it.

## Runtime capabilities

| Capability                                                 | Trigger.dev | Inngest |
| ---------------------------------------------------------- | ----------- | ------- |
| delay, schedule, batch trigger, idempotency key            | yes         | yes     |
| debounce, tags, cancel, queue, retry, ttl, concurrency key | yes         | no      |

`jobs()` throws at startup when an Inngest task sets `queue`, `retry`, `ttl`, `concurrencyKey`, or
`tags` defaults. Task metadata carries `capabilities`, which `supportsJobsRuntimeCapability` reads.

## Documentation

- [Jobs integration](https://farmjs.dev/docs/integrations/jobs)
- [Trigger.dev](https://farmjs.dev/docs/integrations/trigger) and
  [Inngest](https://farmjs.dev/docs/integrations/inngest)
- [`examples/jobs-integration`](https://github.com/farming-labs/farm.js/tree/main/examples/jobs-integration)
  switches between both runtimes with `JOBS_RUNTIME`

Report issues and find examples in the
[Farm.js repository](https://github.com/farming-labs/farm.js).
