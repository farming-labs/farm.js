# Explicit cron infrastructure and deployment synchronization

Status: Implementation in progress. Not released.

## Problem

The cron Infra branch selects its scheduler from credentials and registers jobs during build
preparation. A key used for another Infra service can change the scheduler, and an unsuccessful
build can replace a deployed application's schedules. Removing the final job does not unregister it.

## Decisions

- `cron: { infra: "host" | "farmjs", jobs?: { ... } }` selects the scheduler. `host` is the
  default. Existing `cron: { jobName: { schedule, path } }` declarations remain valid, including
  jobs named `infra` or `jobs`. Route-local schedules merge with either form.
- Only `cron.infra` selects the scheduler. The unreleased `FARM_CRON_SCHEDULER` variable is
  removed, and `FARMJS_API_KEY` alone never opts an app into hosted scheduling.
- Builds only write `.farm/cron-manifest.json` and platform output. Farm.js scheduling emits no
  Farm-owned host timers. An empty or disabled configuration writes an empty manifest.
- After deploying the matching artifact, `farm cron sync --url https://app.example.com` shows
  the replacement plan. `--apply` sends it to Infra. The command reads the built manifest, not
  the current source configuration. Custom output locations use `--manifest`.
- Synchronization requires an explicit HTTPS origin, an explicit `FARMJS_ENVIRONMENT`, and an
  API key with `cron:jobs`. Project scoping uses `FARMJS_PROJECT_ID` when present. There is no
  automatic preview-to-production URL inference. Credentials stay in environment variables.
- A Farm.js manifest replaces the endpoint's job list; a host or empty manifest sends zero jobs
  to clear it. Clearing requires `--allow-delete` with `--apply`. Disable the old host scheduler
  before enabling Infra; clear Infra before enabling a host scheduler. This is an explicit
  deployment transition, not an atomic handoff across independent providers.
- Registration has a deadline, refuses redirects, and validates Infra's acknowledgement.
  Failure leaves the command unsuccessful; it never silently selects another scheduler.

## Alternatives

Registering during build is convenient but cannot establish that an artifact was deployed.
Automatically registering on server startup can race across replicas and grants runtime credentials
deployment authority. A new deployment service is outside this change; the existing CLI and Infra
replace-all API are sufficient.

## Scope and acceptance criteria

Core config, cron manifests and authentication, the cron CLI, existing cron docs and the basic
example. No Infra schema changes are required by the protocol. The hosted service needs Infra's
cron jobs API (`PUT /api/cron/jobs`, permission `cron:jobs`) and its clock worker to be deployed.

Legacy config and job names must remain valid; config must reject invalid selectors. Building and
planning must perform no registration. Host builds retain their scheduler output; Farm.js builds
omit it. Applying a plan must register, replace or clear the exact endpoint/environment/project,
and reject absent credentials, invalid manifests, redirects, timeouts and malformed responses.

## Verification plan

Run regression tests before and after the change, core and CLI checks, production builds and a
packed-package smoke check. Exercise the real Infra contract and signature implementation locally
without contacting the hosted service. Record unverified deployment targets and service rollout in
the PR; do not claim that opening this PR deploys Infra.
