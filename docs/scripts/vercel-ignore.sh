#!/bin/sh
# Vercel's ignored build step: exit 0 skips the build, anything else builds.
# Compare with the last successful deploy, so docs changes whose deploy was skipped
# (rate limit, failed build) still ship. Vercel clones shallow: if that commit is
# missing, build.
base="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
git cat-file -e "$base^{commit}" 2>/dev/null || exit 1
git diff --quiet "$base" HEAD -- \
  ":/docs" ":/packages/farm" ":/packages/farm-cli" ":/packages/farm-devtools" \
  ":/packages/farm-webmcp" ":/pnpm-lock.yaml" ":(exclude,top,glob)**/__tests__/**"
