# Releasing Farm.js

Farm.js releases every public package under `packages/*` through one Bumpp flow. Bumpp updates every package manifest to the selected version, builds the workspace, creates the release commit and Git
tag, and pushes them before pnpm publishes the packages to npm. The first release through
this flow also aligns any currently different package versions.

## Stable release

```bash
pnpm release
```

`pnpm release` is an alias for `pnpm release:latest`. Choose the next version in the Bumpp
prompt. After the build and Git release steps pass, every package is published with npm's
`latest` tag.

## Beta release

```bash
pnpm release:beta
```

Bumpp uses `beta` as the prerelease identifier, then pnpm publishes every package with the
`beta` tag. After every package is published successfully, the release promotes each current
beta to npm's `latest` tag so unqualified installs receive the newest beta. If a package already
has a stable `latest` version, the stable tag is preserved.

## Canary release

```bash
pnpm release:canary
```

This follows the same flow with a `canary` prerelease identifier and npm tag.

## Bump without publishing

```bash
pnpm bump
```

This updates the shared version, builds, commits, tags, and pushes without publishing to
npm.

## Retry a publish

If Bumpp completed but npm publishing failed, do not bump the version again. Retry the
current version directly:

```bash
pnpm publish:latest
pnpm publish:beta
pnpm publish:canary
```

If every beta package was published but updating the `latest` tags failed, retry only the
promotion step instead of publishing again:

```bash
pnpm dist-tags:promote-betas
```

Before releasing, authenticate with npm and confirm that your account can publish public
packages under the `@farm.js` scope.

Run the release verification and package dry-run before starting Bumpp:

```bash
pnpm release:check
pnpm publish:dry-run
```

The release commands require a clean `main` branch. They preserve pnpm's Git checks instead
of bypassing them.
