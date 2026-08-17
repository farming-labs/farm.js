---
title: "Anonymous telemetry"
description: "Understand and control Farm.js opt-in product telemetry."
section: "Reference"
---

# Anonymous telemetry

Farm.js includes optional anonymous product telemetry in `@farm.js/cli` and
`@farm.js/create-app`. During the beta, telemetry is **off by default**. It helps the
maintainers understand which coarse framework paths are useful and where compatibility work should
be focused.

This is separate from [application observability](/docs/observability). OpenTelemetry describes what
your application does and is configured by the application owner. Farm.js product telemetry only
describes use of Farm's own CLI and starter generator, and is sent to Farm's infrastructure after
you opt in.

## Control telemetry

```bash
farm telemetry status
farm telemetry enable
farm telemetry disable
```

`farm telemetry enable` creates a random anonymous installation ID in the operating system's local
configuration directory. `farm telemetry disable` opts out and deletes that ID. Enabling telemetry
again creates a different ID.

Environment variables can provide an explicit per-process or organization-wide policy:

| Variable                    | Behavior                                                            |
| --------------------------- | ------------------------------------------------------------------- |
| `FARM_TELEMETRY=1`          | Enables telemetry, including non-interactive and CI commands.       |
| `FARM_TELEMETRY=0`          | Disables telemetry for the process.                                 |
| `FARM_TELEMETRY_DISABLED=1` | Disables telemetry for the process.                                 |
| `DO_NOT_TRACK=1`            | Disables telemetry and takes precedence over Farm's enable setting. |

Without the explicit `FARM_TELEMETRY=1` override, Farm skips test, CI, and non-interactive
processes even when the saved local preference is enabled.

The preference file is stored at:

- macOS: `~/Library/Application Support/farmjs/telemetry.json`
- Linux: `$XDG_CONFIG_HOME/farmjs/telemetry.json`, or `~/.config/farmjs/telemetry.json`
- Windows: `%APPDATA%\farmjs\telemetry.json`

## Data that is sent

Farm currently sends two versioned event types:

| Event             | Fields                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `command_invoked` | Allowlisted command, optional deploy target, Farm package/version, Node major, OS, CPU class. |
| `project_created` | Allowlisted starter, renderer, package manager, TypeScript/install booleans, runtime fields.  |

Every request also has a random event ID for deduplication and the random local installation ID.
The server immediately converts the installation ID into an HMAC hash using a server-only salt;
the raw ID is not stored. Receipt time is assigned by the server instead of trusting a client
timestamp.

Farm does **not** collect or store:

- project names, filesystem paths, Git remotes, repository names, source code, or route names;
- usernames, email addresses, account IDs, cookies, application payloads, or application events;
- environment variable names or values, database URLs, credentials, tokens, or other secrets;
- IP addresses or user-agent strings.

The client uses a short timeout and ignores network or server failures. Telemetry can never make a
Farm command fail. There is no persistent retry queue.

## Endpoint, validation, and retention

Events are posted to `https://farmjs.dev/api/telemetry/v1/events`. The endpoint accepts a strict,
versioned JSON schema, rejects unknown fields and bodies larger than 8 KiB, rate-limits traffic,
and deduplicates event IDs.

Raw telemetry events are retained for 90 days by default and are pruned by the ingestion service.
Aggregated package-download counts remain available independently through npm's public download
statistics. A deployment operator can shorten the event retention window with
`FARM_TELEMETRY_RETENTION_DAYS`.

For local endpoint development only, `FARM_TELEMETRY_ENDPOINT` can point at an HTTPS URL or an HTTP
localhost address. Released clients use the Farm-owned endpoint by default.

## Maintainer deployment setup

The Farm-owned docs deployment uses four server-only environment variables:

| Variable                         | Purpose                                                              |
| -------------------------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`                   | Pooled Postgres connection used by Prisma.                           |
| `FARM_TELEMETRY_IDENTITY_SALT`   | Long random secret used to HMAC-hash local anonymous IDs.            |
| `FARM_TELEMETRY_DASHBOARD_TOKEN` | Long random secret used to open the internal `/telemetry` dashboard. |
| `FARM_TELEMETRY_RETENTION_DAYS`  | Optional raw-event retention window; defaults to `90`.               |

These values must be encrypted deployment variables and must never use a `PUBLIC_` prefix or be
committed to the repository. The public CLI does not contain an ingestion secret; the endpoint is
protected with strict validation, body limits, rate limits, and idempotent event IDs instead.

After connecting Postgres, generate the Prisma client and apply the schema from the repository:

```bash
pnpm --dir docs prisma:generate
pnpm --dir docs db:push
```

`/telemetry` exchanges the dashboard token through a server-side form for a 12-hour HttpOnly,
SameSite cookie. The token is not placed in the URL, local storage, or client-side JavaScript.
