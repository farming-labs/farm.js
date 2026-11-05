# @farm.js/cli

The `farm` command for Farm.js apps. It runs the development server, builds and starts production
output, generates route and API types, diagnoses projects, adds integrations, deploys, and upgrades
Farm packages.

See [Stability and Support](https://farmjs.dev/docs/stability) for what this package guarantees.

## Install

```bash
pnpm add -D @farm.js/cli
```

The package exposes the `farm` binary (`bin/farm.js`) and requires Node.js 22.13 or newer. It
depends on the matching `@farm.js/core` release, so keep both on the same version; `farm upgrade`
does this for you. Call it from package scripts, as the starters do:

```json
{
  "scripts": {
    "dev": "farm dev",
    "build": "farm build",
    "start": "node .farm/.output/server/index.mjs"
  }
}
```

## Create an app

New projects come from the separate `@farm.js/create-app` package. pnpm resolves the
`@farm.js/app` initializer name to it:

```bash
pnpm create @farm.js/app my-app --template basic
pnpm create @farm.js/app my-vue-app --template basic --renderer vue
pnpm create @farm.js/app --list-templates
```

React is the default renderer. `--skip-install` writes the files without installing dependencies.

## Commands

| Command                           | What it does                                                                     |
| --------------------------------- | -------------------------------------------------------------------------------- |
| `farm dev`                        | Start the development server. `--port`, `--host`, and `--cron` are available.    |
| `farm build`                      | Build for production. `--preset <preset>` overrides the Nitro preset.            |
| `farm start`                      | Run the Node server produced by `farm build`.                                    |
| `farm generate`                   | Generate route and API types and integration schema artifacts.                   |
| `farm generate --check`           | Fail when committed generated types are stale, without writing files.            |
| `farm doctor`                     | Inspect project configuration and the running app. Add `--offline` or `--json`.  |
| `farm explain <path>`             | Explain how a URL maps to a route, its layouts, middleware, and runtime.         |
| `farm agent check [url]`          | Probe a running app's Markdown mirrors, `llms.txt`, API catalog, and MCP.        |
| `farm add integration [provider]` | Add an official integration. `--ui` adds its UI, `--list` shows providers.       |
| `farm deploy`                     | Deploy from `deploy.target`, or pass `--vercel`, `--cloudflare`, or `--netlify`. |
| `farm deploy --plan`              | Print the resolved deployment plan without building or deploying.                |
| `farm upgrade`                    | Upgrade Farm packages to one release channel (see below).                        |
| `farm migrate [source]`           | Run `migrations.commands`, or migrate from `next` or `tanstack`.                 |
| `farm schema check`               | Compare the tables integrations and plugins declare with the live database.      |
| `farm schema migrate`             | Create those tables, dependencies first. `--apply` runs the statements.          |
| `farm auth migrate`               | Create or update the Farm Auth database schema.                                  |
| `farm cron list`                  | List the cron routes configured in `farm.config`.                                |
| `farm cron run <name>`            | Invoke one configured cron route on a running app.                               |
| `farm preview`                    | Create a public URL for a running local app.                                     |
| `farm login`                      | Sign in to Farm Preview. `farm whoami` and `farm logout` check and clear it.     |
| `farm telemetry status`           | Show the telemetry setting. `enable` and `disable` change it.                    |

Run `farm --help` or `farm <command> --help` for every flag. Framework migrations print a dry-run
plan unless `--write` is passed. A plugin or integration that declares database tables also gets
`farm <name> migrate`.

`farm dev` and `farm build` accept `--desktop` for a packaged desktop app and `--mobile` for the
Android shell (preview). `farm config inspect --desktop` or `--mobile` prints the resolved block.

## Upgrade Farm packages

Upgrade every published `@farm.js/*` dependency in an app to one release channel:

```bash
farm upgrade --latest
farm upgrade --beta
farm upgrade --latest --dry-run
```

`--latest` selects the newest stable release. `--beta` selects the newest beta release. Exactly one
channel is required. The CLI detects npm, pnpm, Yarn, or Bun from the project, keeps each package in
its dependency section, and leaves `workspace:`, `file:`, `link:`, `portal:`, and `catalog:`
references unchanged. `--dry-run` prints the package-manager commands without installing.

## Diagnose a project

`farm doctor` probes the running app first and falls back to config and filesystem checks when
none answers. It is read-only by default and exits non-zero only when a check fails, so it can run
in CI. `--fix` applies safe additive corrections, such as creating a missing `src/app/layout.tsx`,
and never overwrites application files.

## Telemetry

Interactive local commands send anonymous product telemetry. Run `farm telemetry disable` to opt
out, or set `DO_NOT_TRACK=1` or `FARM_TELEMETRY=0` for a process. CI and non-interactive runs skip
it.

## Documentation

- [CLI](https://farmjs.dev/docs/cli)
- [Getting Started](https://farmjs.dev/docs/getting-started)
- [Doctor](https://farmjs.dev/docs/doctor)
- [Upgrading](https://farmjs.dev/docs/upgrading)
- [Deployment](https://farmjs.dev/docs/deployment)
- [Instant Preview](https://farmjs.dev/docs/preview)
- [Anonymous telemetry](https://farmjs.dev/docs/telemetry)

Report issues and find examples in the [Farm.js repository](https://github.com/farming-labs/farm.js).
