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
prompt. After the build and Git release steps pass, `pnpm publish:latest` publishes every public
package that is not on npm yet under the dist-tag its own version implies: a stable version such as
`0.1.0` goes to `latest`, and an independently versioned package that is still `0.1.0-beta.N` goes
to `beta`. It then verifies registry visibility and promotes betas exactly like a beta release.
An independently versioned package is not bumped by this command.

The first stable release moves the shared group from `0.1.0-beta.N` to `0.1.0`. Packages outside
`bump.config.ts` stay on their own beta line until they are deliberately promoted.

## Independent React compiler stable promotion

`@farm.js/react` is not in the shared Bumpp group. Moving its configuration from
`experimental.compiler` to `compiler` does not promote its npm version or dist-tags. Keep API
preparation in a draft PR until these release gates have been recorded on its final commit:

- Document the opt-in defaults, supported options, deprecated alias, React fallback, and the
  requirement to rebuild server and browser output against one compiler/runtime package version.
- Run the React package tests and stress suite, type-check, React 18/19 packed compatibility
  tests, and `test:runtime-size`. Verify the compiler-disabled path as well as enabled builds.
- Run the maintained production browser example and generated compiler starter. Check hydration,
  interactions, fallback, and the generated compiler coverage report, not just a successful build.
- Run generator tests, docs navigation/build checks, and the normal CI matrix on the final head.
  A prior green commit is not evidence for later changes.
- Keep unproven performance experiments out of the release. A configuration-only migration must
  preserve generated code and runtime size; runtime changes need paired correctness-controlled
  before/after benchmarks.

After building the core, CLI, devtools, React, and create-app packages, run the generated-starter
gate with `pnpm test:packed-compiler`. It installs the generator and reachable Farm packages from
local tarballs outside the workspace, type-checks the generated app, and browser-tests development
and production with the compiler both enabled and disabled. The development check edits only the
temporary starter's counter, verifies that state survives hot updates without a page reload,
checks the changed event handler, then restores the original source and checks another update.
The production checks run against the restored starter. The gate does not publish.
Install the workspace Playwright browser with `pnpm exec playwright install chromium`, or set
`FARM_EXPERIMENT_BROWSER_PATH` to an existing Chrome/Chromium executable. Screenshots default to
the system temporary directory as `farm-packed-react-compiler-on.png` and
`farm-packed-react-compiler-off.png`, with `-dev-on.png` and `-dev-off.png` for development;
`FARM_EXPERIMENT_SCREENSHOT` selects another base filename.
The existing `pnpm test:packed-app` still checks the basic starter without requiring a browser.

After those gates pass, make the independent version promotion as a dedicated release change,
not a shared-group bump. Use the versioning tool for the chosen non-prerelease version and run
`scripts/sync-release-versions.js` so starter dependencies follow the actual React package version.
Review that only the intended package and its consumers change. Update the stability page's package
classification when promoting; the default React renderer in core is already stable.

From clean `main`, run `pnpm release:check` and `pnpm publish:dry-run` before publishing. Inspect
all unpublished public package versions first: `pnpm publish:latest` can publish more than React.
After publishing, verify the React version and `latest` dist-tag in the registry and install the
published package into a fresh compiler starter for a production smoke test. Do not describe the
compiler as released while only the draft PR or a local version change exists.

## Beta release

```bash
pnpm release:beta
```

Bumpp uses `beta` as the prerelease identifier for the shared release group, then pnpm publishes
the new shared versions with the `beta` tag while leaving independently versioned packages at
their current versions. Every package is published under the tag its version implies, so stable
packages that were not bumped are simply skipped. After every current beta is visible, the release
promotes it to npm's `latest` tag so unqualified installs receive the newest beta, unless the
package already has a stable `latest` version, which is always preserved. Promotion checks that a
stable package's `latest` tag points at its current version and rejects prerelease identifiers
other than `beta`.

To build and publish a beta without running the test suite, pass `--no-test`:

```bash
pnpm release:beta --no-test
```

Before a release, validate the complete public package set without contacting
the registry or changing any dist-tags:

```bash
pnpm publish:beta --dry-run
```

This runs pnpm's publish dry run for every public package under `packages/`.
Use `pnpm publish:beta --verify-only` only after a real publish has completed
partially and the registry needs time to expose staged versions.

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

The package dry-run packs every public package into a temporary directory and removes the
archives afterward. It does not consult npm, so packages are checked even when their current
versions are already published.

The release commands require a clean `main` branch. They preserve pnpm's Git checks instead
of bypassing them.
