import { FARM_VERSION } from "@farm.js/core/version";

/**
 * The newest Farm.js release, for telling a checked site whether it is behind. npm's `latest`
 * dist-tag is what `farm upgrade --latest` installs, so it is the release to compare against;
 * this site's own Farm.js version (it deploys from main) is the fallback when npm can't be
 * reached, and is at most a release ahead of it. Server only.
 */

const REGISTRY_URL = "https://registry.npmjs.org/@farm.js/core/latest";
const FRESH_MS = 5 * 60_000;
// After a failure, use the fallback for a minute instead of asking npm on every report.
const RETRY_MS = 60_000;
const TIMEOUT_MS = 3_000;
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?(?:\+[0-9A-Za-z.-]{1,40})?$/;

export interface LatestFarmVersionOptions {
  fetch?: typeof fetch;
  now?: () => number;
  fallback?: string;
}

export function createLatestFarmVersion({
  fetch: request = (input, init) => fetch(input, init),
  now = Date.now,
  fallback = FARM_VERSION,
}: LatestFarmVersionOptions = {}): () => Promise<string> {
  let cached: { version: string; until: number } | null = null;
  let pending: Promise<string> | null = null;

  async function lookup(): Promise<string> {
    try {
      const response = await request(REGISTRY_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = response.ok ? ((await response.json()) as { version?: unknown }) : null;
      const version = body?.version;
      if (typeof version === "string" && VERSION.test(version)) {
        cached = { version, until: now() + FRESH_MS };
        return version;
      }
    } catch {
      // Unreachable or not JSON: fall back below.
    }
    cached = { version: fallback, until: now() + RETRY_MS };
    return fallback;
  }

  return () => {
    if (cached && cached.until > now()) return Promise.resolve(cached.version);
    pending ??= lookup().finally(() => {
      pending = null;
    });
    return pending;
  };
}

/** The newest Farm.js release, cached for a few minutes. Never throws. */
export const latestFarmVersion = createLatestFarmVersion();
