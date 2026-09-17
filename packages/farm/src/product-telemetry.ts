import { FARM_VERSION } from "./version";

export const FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION = 1 as const;
export const FARM_PRODUCTION_SITE_TELEMETRY_EVENT_TYPE = "production_site_active" as const;
export const FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME = "@farm.js/core" as const;
export const FARM_PRODUCTION_SITE_ATTESTATION_PATH = "/.well-known/farm-telemetry" as const;
export const FARM_PRODUCTION_SITE_ATTESTATION_EVENT_TYPE = "production_site_attestation" as const;

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

export interface FarmProductionSiteAttestation {
  schemaVersion: typeof FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION;
  eventType: typeof FARM_PRODUCTION_SITE_ATTESTATION_EVENT_TYPE;
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
  handleAttestation(request: Request): Response | null;
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
  const attestation: FarmProductionSiteAttestation = {
    schemaVersion: FARM_PRODUCTION_SITE_TELEMETRY_SCHEMA_VERSION,
    eventType: FARM_PRODUCTION_SITE_ATTESTATION_EVENT_TYPE,
    packageName: FARM_PRODUCTION_SITE_TELEMETRY_PACKAGE_NAME,
    packageVersion: sanitizeDetail(FARM_VERSION, "unknown"),
    renderer: sanitizeDetail(options.renderer, "custom"),
    deployTarget: sanitizeDetail(options.deployTarget, "custom"),
  };

  return {
    handleAttestation(request) {
      if (productionTelemetryDisabled()) return null;

      let pathname: string;
      try {
        pathname = new URL(request.url).pathname;
      } catch {
        return null;
      }
      if (pathname !== FARM_PRODUCTION_SITE_ATTESTATION_PATH) return null;

      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: {
            allow: "GET, HEAD",
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-content-type-options": "nosniff",
          },
        });
      }

      return new Response(request.method === "HEAD" ? null : JSON.stringify(attestation), {
        status: 200,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    },
    report(requestUrl, waitUntil) {
      if (productionTelemetryDisabled()) return;
      if (!isProductionDeploymentEnvironment()) {
        debug("production-site check-in skipped outside a production deployment");
        return;
      }

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
        packageVersion: attestation.packageVersion,
        renderer: attestation.renderer,
        deployTarget: attestation.deployTarget,
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
  endpoint: string | undefined,
  payload: FarmProductionSiteTelemetryPayload,
): Promise<boolean> {
  if (!endpoint) {
    debug("invalid or insecure production-site telemetry endpoint; check-in skipped");
    return false;
  }

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

function resolveSiteTelemetryEndpoint(explicit?: string): string | undefined {
  const candidate = explicit || process.env.FARM_TELEMETRY_SITE_ENDPOINT;
  if (!candidate) return DEFAULT_SITE_TELEMETRY_ENDPOINT;

  try {
    const url = new URL(candidate);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(hostname);
    if (url.protocol === "https:" || (url.protocol === "http:" && isLocal)) {
      return url.toString();
    }
  } catch {
    // Invalid explicit overrides fail closed below.
  }
  return undefined;
}

function productionTelemetryDisabled(): boolean {
  if (process.env.DO_NOT_TRACK !== undefined && !isFalse(process.env.DO_NOT_TRACK)) return true;
  if (isTrue(process.env.FARM_TELEMETRY_DISABLED)) return true;
  return isFalse(process.env.FARM_TELEMETRY);
}

/**
 * Only a provider's production environment represents a production site;
 * preview, branch, and development deployments must not create dashboard
 * entries. Each provider exposes this differently, so every signal we can read
 * is checked. A deployment whose provider exposes no environment metadata stays
 * eligible, so self-hosted sites continue to report.
 *
 * Cloudflare Pages is deliberately absent: it exposes `CF_PAGES_BRANCH` for both
 * production and preview deployments and no environment flag that distinguishes
 * them, so there is nothing here that could be read without guessing.
 */
function isProductionDeploymentEnvironment(): boolean {
  // Vercel exposes the deployment environment at build and runtime.
  const environment = normalizeEnvironment(process.env.VERCEL_ENV);
  const targetEnvironment = normalizeEnvironment(process.env.VERCEL_TARGET_ENV);
  if (environment && environment !== "production") return false;
  if (targetEnvironment && targetEnvironment !== "production") return false;

  // Netlify: CONTEXT is production | deploy-preview | branch-deploy | dev.
  // CONTEXT is a generic name, so it is only trusted when NETLIFY marks the
  // build as Netlify's.
  if (isTrue(process.env.NETLIFY)) {
    const context = normalizeEnvironment(process.env.CONTEXT);
    if (context && context !== "production") return false;
  }

  // Render marks pull-request preview services.
  if (isTrue(process.env.IS_PULL_REQUEST)) return false;

  return true;
}

function normalizeEnvironment(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
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
