# Releasing Farm.js

Farm.js releases all eight packages through one Bumpp flow. Bumpp updates every package
manifest to the selected version, builds the workspace, creates the release commit and Git
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
`beta` tag.

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

Before releasing, authenticate with npm and confirm that your account can publish public
packages under the `@farm.js` scope.
