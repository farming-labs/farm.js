import { FARM_VERSION } from "./version";

export const FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION = 1 as const;
export const FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE = "production_site_active" as const;
export const FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME = "@farm.js/core" as const;

const DEFAULT_SITE_TELEMETRY_ENDPOINT = "https://farmjs.dev/api/telemetry/v1/sites";
const REQUEST_TIMEOUT_MS = 3_000;
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const RETRY_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_ORIGINS_PER_INSTANCE = 32;
const SAFE_DETAIL_PATTERN = /^[0-9A-Za-z._-]{1,64}$/;

export interface FarmProductionSiteTelemetryPayload {
  schemaVersion: typeof FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION;
  eventType: typeof FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE;
  siteUrl: string;
  packageName: typeof FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME;
  packageVersion: string;
  renderer: string;
  deployTarget: string;
}

interface FarmProductionSiteReporterOptions {
  renderer: string;
  deployTarget?: string;
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => number;
  reportIntervalMs?: number;
  retryIntervalMs?: number;
}

interface OriginReportState {
  pending?: Promise<void>;
  nextReportAt: number;
}

export interface FarmProductionSiteReporter {
  report(requestUrl: string | URL, waitUntil?: (promise: Promise<unknown>) => void): void;
}

/**
 * Reduce an automatically observed request URL to a public HTTPS origin.
 * Request paths, query strings, hashes, and credentials are never returned.
 */
export function detectFarmProductionSiteOrigin(value: string | URL): string | undefined {
  try {
    const url = value instanceof URL ? value : new URL(value);
    return normalizeFarmProductionSiteOrigin(url.origin);
  } catch {
    return undefined;
  }
}

/** Normalize and validate the origin-only value accepted by the ingestion service. */
export function normalizeFarmProductionSiteOrigin(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.length > 2_048) return undefined;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase();
    const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
    const isIpv6 = hostname.startsWith("[") && hostname.endsWith("]");
    const isLocal =
      hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local");
    const isSingleLabel = !hostname.includes(".");

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      isIpv4 ||
      isIpv6 ||
      isLocal ||
      isSingleLabel ||
      hostname.endsWith(".")
    ) {
      return undefined;
    }

    return url.origin;
  } catch {
    return undefined;
  }
}

export function createFarmProductionSiteReporter(
  options: FarmProductionSiteReporterOptions,
): FarmProductionSiteReporter {
  const now = options.now ?? Date.now;
  const reportIntervalMs = options.reportIntervalMs ?? REPORT_INTERVAL_MS;
  const retryIntervalMs = options.retryIntervalMs ?? RETRY_INTERVAL_MS;
  const send = options.fetch ?? globalThis.fetch;
  const reportStates = new Map<string, OriginReportState>();

  return {
    report(requestUrl, waitUntil) {
      if (productionTelemetryDisabled()) return;

      const siteUrl = detectFarmProductionSiteOrigin(requestUrl);
      if (!siteUrl) return;

      let state = reportStates.get(siteUrl);
      if (!state) {
        if (reportStates.size >= MAX_ORIGINS_PER_INSTANCE) return;
        state = { nextReportAt: 0 };
        reportStates.set(siteUrl, state);
      }

      const attemptedAt = now();
      if (state.pending || attemptedAt < state.nextReportAt) return;

      state.nextReportAt = attemptedAt + reportIntervalMs;
      const payload: FarmProductionSiteTelemetryPayload = {
        schemaVersion: FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION,
        eventType: FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE,
        siteUrl,
        packageName: FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME,
        packageVersion: sanitizeDetail(FARM_VERSION, "unknown"),
        renderer: sanitizeDetail(options.renderer, "custom"),
        deployTarget: sanitizeDetail(options.deployTarget, "custom"),
      };
      state.pending = deliver(send, resolveSiteTelemetryEndpoint(options.endpoint), payload)
        .then((delivered) => {
          if (!delivered) state.nextReportAt = now() + retryIntervalMs;
        })
        .catch(() => {
          state.nextReportAt = now() + retryIntervalMs;
        })
        .finally(() => {
          state.pending = undefined;
        });

      if (waitUntil) {
        try {
          waitUntil(state.pending);
        } catch {
          // Delivery remains best-effort if a platform rejects background work.
        }
      } else {
        void state.pending;
      }
    },
  };
}

async function deliver(
  send: typeof fetch,
  endpoint: string,
  payload: FarmProductionSiteTelemetryPayload,
): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  timeout.unref?.();
  try {
    const response = await send(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      debug(`production-site check-in rejected with HTTP ${response.status}`);
      return false;
    }
    try {
      const result = (await response.json()) as { stored?: unknown };
      if (result && result.stored === false) {
        debug("production-site check-in was accepted but not stored");
        return false;
      }
    } catch {
      // A successful empty response is also a valid acknowledgement.
    }
    return true;
  } catch {
    debug("production-site check-in failed");
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSiteTelemetryEndpoint(explicit?: string): string {
  const candidate = explicit || process.env.FARM_TELEMETRY_SITE_ENDPOINT;
  if (!candidate) return DEFAULT_SITE_TELEMETRY_ENDPOINT;

  try {
    const url = new URL(candidate);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocal)) {
      return url.toString();
    }
  } catch {
    // Fall through to the Farm-owned endpoint.
  }
  return DEFAULT_SITE_TELEMETRY_ENDPOINT;
}

function productionTelemetryDisabled(): boolean {
  if (process.env.DO_NOT_TRACK !== undefined && !isFalse(process.env.DO_NOT_TRACK)) return true;
  if (isTrue(process.env.FARM_TELEMETRY_DISABLED)) return true;
  return isFalse(process.env.FARM_TELEMETRY);
}

function sanitizeDetail(value: string | undefined, fallback: string): string {
  return value && SAFE_DETAIL_PATTERN.test(value) ? value : fallback;
}

function isTrue(value: string | undefined): boolean {
  return value !== undefined && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function isFalse(value: string | undefined): boolean {
  return value !== undefined && ["0", "false", "no", "off"].includes(value.toLowerCase());
}

function debug(message: string): void {
  if (!isTrue(process.env.FARM_TELEMETRY_DEBUG)) return;
  process.stderr.write(`[farm.telemetry] ${message}\n`);
}
