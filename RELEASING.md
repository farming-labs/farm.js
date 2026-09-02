# Releasing Farm.js

Farm.js has a shared release group defined by the package manifests listed in `bump.config.ts`.
Bumpp updates that group to the selected version, builds the workspace, creates the release commit
and Git tag, and pushes them before pnpm publishes packages to npm. Public packages omitted from
the Bumpp list keep their independently managed versions. Release preparation synchronizes starter
dependencies to the actual version of each workspace package instead of forcing those packages into
the shared version.

## Stable release

```bash
pnpm release
```

`pnpm release` is an alias for `pnpm release:latest`. Choose the next version in the Bumpp
prompt. After the build and Git release steps pass, newly versioned shared packages are published
with npm's `latest` tag. An independently versioned package is not bumped by this command; pnpm
publishes it only when its current version is not already present on npm.

## Beta release

```bash
pnpm release:beta
```

Bumpp uses `beta` as the prerelease identifier for the shared release group, then pnpm publishes
the new shared versions with the `beta` tag while leaving independently versioned packages at
their current versions. Before starting, confirm that every public package's current manifest
version, including every independently versioned package, is a beta. The promotion step rejects a
stable current version instead of skipping that package, which aborts the release after publishing.
After every current beta is visible, the release promotes it to npm's `latest` tag so unqualified
installs receive the newest beta. If a package already has a stable `latest` version, that stable tag
is preserved.

To build and publish a beta without running the test suite, pass `--no-test`:

```bash
pnpm release:beta --no-test
```

This still synchronizes template versions, builds every public package, and performs the normal
npm publish and dist-tag promotion steps. Use it only when the release has already been tested or
when intentionally accepting the risk of publishing without the release test suite.

## Canary release

```bash
pnpm release:canary
```

This follows the same flow with a `canary` prerelease identifier and npm tag.

## Bump without publishing

```bash
pnpm bump
```

This updates the packages in the shared Bumpp group, builds, commits, tags, and pushes without
publishing to npm. Independently versioned packages remain unchanged.

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
