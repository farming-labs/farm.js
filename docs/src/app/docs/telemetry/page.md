---
title: "Product telemetry"
description: "Understand and control Farm.js CLI and production-site telemetry."
section: "Reference"
---

# Product telemetry

Farm.js has two separately controlled product-telemetry paths:

- Anonymous command telemetry in `@farm.js/cli` (`farm`) and `@farm.js/create-app` is **enabled by
  default** for interactive local commands.
- Production website reporting is **enabled by default** in built server runtimes and automatically
  reduces incoming production request URLs to their public HTTPS origin.

These signals help the maintainers understand which coarse framework paths are useful, where
compatibility work should be focused, and which websites are running Farm in production.

This is separate from [application observability](/docs/observability). OpenTelemetry describes what
your application does and is configured by the application owner. Farm.js product telemetry never
includes application spans, logs, visitor analytics, or request contents.

## Control CLI telemetry

```bash
farm telemetry status
farm telemetry enable
farm telemetry disable
```

The first eligible event creates a random anonymous installation ID in the operating system's local
configuration directory. `farm telemetry disable` opts out and deletes that ID. Running
`farm telemetry enable` later creates a different ID. Saved opt-out preferences remain respected
across upgrades.

Environment variables can provide an explicit per-process or organization-wide policy:

| Variable                    | Behavior                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| `FARM_TELEMETRY=1`          | Enables CLI telemetry, including non-interactive and CI commands.       |
| `FARM_TELEMETRY=0`          | Disables CLI and production-site telemetry for the process.             |
| `FARM_TELEMETRY_DISABLED=1` | Disables CLI and production-site telemetry for the process.             |
| `DO_NOT_TRACK=1`            | Disables all telemetry and takes precedence over Farm's enable setting. |
| `FARM_TELEMETRY_DEBUG=1`    | Prints delivery status without event contents, origins, or identifiers. |

Without the explicit `FARM_TELEMETRY=1` override, Farm skips test, CI, and non-interactive
processes even when the saved local preference is enabled.

The preference file is stored at:

- macOS: `~/Library/Application Support/farmjs/telemetry.json`
- Linux: `$XDG_CONFIG_HOME/farmjs/telemetry.json`, or `~/.config/farmjs/telemetry.json`
- Windows: `%APPDATA%\farmjs\telemetry.json`

## Automatic production-site detection

No site URL configuration is required. After the first non-health request reaches a built Farm
server runtime, Farm reads the request URL and reduces it to an origin. For example,
`https://shop.example.com/private/orders?token=secret` becomes only
`https://shop.example.com` before telemetry delivery.

Farm accepts detected origins only when they use HTTPS and a public hostname. HTTP, localhost, IP,
single-label, and `.local` origins are ignored. Request paths, query strings, hashes, and credentials
are discarded and never included in the check-in.

To disable production-site reporting in `farm.config.ts`:

```ts title="farm.config.ts"
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  telemetry: false,
});
```

Set `FARM_TELEMETRY=0` or `FARM_TELEMETRY_DISABLED=1` only in selected deployment environments
when, for example, previews should be excluded while production remains enabled.

After the first non-health production request, Farm schedules a check-in through the deployment
runtime's background-work hook. It does not wait for the network before handling or returning the
application response. A running instance checks in at most once every 24 hours, and a failed request
is eligible for a later best-effort retry. Multiple instances update the same site record.

The check-in contains only the detected origin, `@farm.js/core` version, renderer name, and deploy
target. It does not contain a visitor or installation identifier, the full request URL beyond the
reported origin, headers, cookies, IP address, user-agent string, or application data. Fully static
exports have no server runtime and therefore do not send production-site check-ins. Public preview
deployments can report their own HTTPS origin; disable telemetry in the preview environment if those
should not appear.

Set `telemetry: false` and redeploy to stop future check-ins. An inactive site disappears from the
maintainer dashboard after the retention window.

## Data that is sent

Farm currently sends three versioned event types:

| Event                    | Fields                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------- |
| `command_invoked`        | Allowlisted command from `farm` or `create-farm-app`, package/version, optional deploy target, runtime. |
| `project_created`        | Allowlisted starter, renderer, package manager, TypeScript/install booleans, runtime fields.            |
| `production_site_active` | Automatically detected HTTPS origin, core version, renderer, and deploy target.                         |

The `farm` binary records each actionable command path, including nested commands such as
`auth:migrate`, `cron:list`, `cron:run`, and `add:integration`. The app generator records `create`
or `list-templates`, and a completed scaffold also records `project_created`. Help, version, and the
`farm telemetry` privacy-control commands do not emit events.

Every CLI event also has a random event ID for deduplication and the random local installation ID.
The server immediately converts the installation ID into an HMAC hash using a server-only salt;
the raw ID is not stored. Production-site check-ins have neither identifier and are upserted by the
detected origin. Receipt time is assigned by the server instead of trusting a client timestamp.

Farm does **not** collect or store:

- project names, filesystem paths, Git remotes, repository names, source code, or route names;
- usernames, email addresses, account IDs, cookies, application payloads, or application events;
- environment variable names or values, database URLs, credentials, tokens, or other secrets;
- IP addresses or user-agent strings.

The CLI client schedules delivery in the background so telemetry does not delay command execution,
and network delivery does not keep a short-lived process open. A request has a three-second timeout
and transient network, rate-limit, and server failures receive two bounded retries while the process
remains alive. Telemetry can never make a Farm command fail, and there is no persistent retry queue.

## Endpoint, validation, and retention

CLI events are posted to `https://farmjs.dev/api/telemetry/v1/events`; production-site check-ins are
posted to `https://farmjs.dev/api/telemetry/v1/sites`. Both endpoints accept a strict, versioned JSON
schema, reject unknown fields and bodies larger than 8 KiB, and rate-limit traffic. CLI events are
deduplicated by event ID, while production sites are upserted by their normalized origin.
Because the public clients contain no ingestion secret, dashboard origins are usage signals rather
than verified domain-ownership records.

Raw telemetry events and inactive production-site records are retained for 90 days by default and
are pruned by the ingestion service. Aggregated package-download counts remain available
independently through npm's public download statistics. A deployment operator can change the
retention window with `FARM_TELEMETRY_RETENTION_DAYS`.

For local endpoint development only, `FARM_TELEMETRY_ENDPOINT` and
`FARM_TELEMETRY_SITE_ENDPOINT` can point at an HTTPS URL or an HTTP localhost address. Released
clients use the Farm-owned endpoints by default.

## Maintainer deployment setup

The Farm-owned docs deployment uses four server-only environment variables:

| Variable                         | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                   | Pooled Postgres connection used by Prisma.                           |
| `FARM_TELEMETRY_IDENTITY_SALT`   | Long random secret used to HMAC-hash local anonymous IDs.            |
| `FARM_TELEMETRY_DASHBOARD_TOKEN` | Long random secret used to open the internal `/telemetry` dashboard. |
| `FARM_TELEMETRY_RETENTION_DAYS`  | Optional event and inactive-site retention window; defaults to `90`. |

These values must be encrypted deployment variables and must never use a `PUBLIC_` prefix or be
committed to the repository. Public telemetry clients do not contain an ingestion secret; the
endpoints use strict validation, body limits, rate limits, event deduplication, and site upserts
instead.

After connecting Postgres, generate the Prisma client and apply the schema from the repository:

```bash
pnpm --dir docs prisma:generate
pnpm --dir docs db:push
```

`/telemetry` exchanges the dashboard token through a server-side form for a 12-hour HttpOnly,
SameSite cookie. The token is not placed in the URL, local storage, or client-side JavaScript.
