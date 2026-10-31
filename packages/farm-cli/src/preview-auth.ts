import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { logger } from "@farm.js/core/internal/cli-runtime";
import type { PreviewGatewayPlan } from "./preview-gateway";
import { formatCompactPreviewDuration } from "./preview-duration";

export const PREVIEW_EXPIRY_CLOCK_SKEW_MS = 1000 * 60 * 5;

export interface PreviewAuthPublicConfig {
  enabled: boolean;
  controlAuth?: "bearer" | "query";
  provider?: "github" | "device";
  issuer?: string;
  dashboardUrl?: string;
  clientId?: string;
  scope?: string;
  defaultSessionTtlMs: number;
  maxSessionTtlMs: number;
}

export interface AuthorizePreviewPlanOptions {
  expiresInMs?: number;
  forceLogin?: boolean;
  runtime?: PreviewAuthRuntime;
  /**
   * @deprecated Sign-in no longer writes FARMJS_PROJECT_ID to the app's .env, so this is
   * unused. Previews never read it, and analytics keys name their own project.
   */
  root?: string;
}

/** @deprecated Sign-in no longer offers projects; previews never needed one. */
export interface PreviewProject {
  id: string;
  name: string;
  organization: string;
}

export interface PreviewAuthRuntime {
  interactive?: boolean;
  fetch: typeof fetch;
  openBrowser(url: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  credentials: PreviewCredentialStore;
  promptDuration(config: PreviewAuthPublicConfig): Promise<number | undefined>;
  /** A yes/no question; Enter means yes. */
  confirm(question: string): Promise<boolean>;
  /** @deprecated Never called: sign-in no longer offers projects. */
  chooseProject?(projects: PreviewProject[]): Promise<PreviewProject | undefined>;
}

/** The developer chose not to create an API key after signing in. */
export class PreviewApiKeyDeclinedError extends Error {
  constructor() {
    super(
      "No API key was created. Run farm login when you want one, or set FARMJS_API_KEY to a key from Farm.js Infrastructure.",
    );
    this.name = "PreviewApiKeyDeclinedError";
  }
}

export interface PreviewCredentialStore {
  get(gatewayUrl: string): Promise<string | undefined>;
  set(gatewayUrl: string, token: string): Promise<void>;
  delete(gatewayUrl: string): Promise<void>;
}

/** Where Farm.js Infrastructure lives unless FARMJS_API_URL says otherwise, as for analytics. */
const DEFAULT_INFRA_URL = "https://app.farmjs.dev";

export interface PreviewEnvironmentCredential {
  token: string;
  source: "FARMJS_API_KEY" | "FARM_PREVIEW_TOKEN";
}

/**
 * The credential the environment gives this gateway, if any. FARMJS_API_KEY is a
 * Farm.js Infrastructure key, so it only goes to a gateway that signs in through that
 * same Infrastructure: a GitHub sign-in gateway, or another installation, can't use it.
 * FARM_PREVIEW_TOKEN is deprecated but still honored.
 */
export function previewCredentialFromEnvironment(
  config: PreviewAuthPublicConfig,
  env: Record<string, string | undefined> = process.env,
  warn: (message: string) => void = (message) => logger.warn(message),
): PreviewEnvironmentCredential | undefined {
  const legacy = env.FARM_PREVIEW_TOKEN?.trim() || undefined;
  const key = env.FARMJS_API_KEY?.trim() || undefined;
  if (
    key &&
    config.provider === "device" &&
    sameOrigin(config.issuer, env.FARMJS_API_URL?.trim() || DEFAULT_INFRA_URL)
  ) {
    if (legacy && legacy !== key) {
      throw new Error(
        "FARMJS_API_KEY and the deprecated FARM_PREVIEW_TOKEN hold different credentials. Unset FARM_PREVIEW_TOKEN.",
      );
    }
    return { token: key, source: "FARMJS_API_KEY" };
  }
  if (!legacy) return undefined;
  // Only where an API key works; a GitHub sign-in gateway has no replacement to point to.
  if (config.provider === "device") {
    warn(
      "FARM_PREVIEW_TOKEN is deprecated. Set FARMJS_API_KEY to your Farm.js Infrastructure API key instead.",
    );
  }
  return { token: legacy, source: "FARM_PREVIEW_TOKEN" };
}

function sameOrigin(left: string | undefined, right: string) {
  try {
    return !!left && new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

interface GitHubDeviceAuthorization {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

interface PreviewAccountExchange {
  token: string;
  expiresAt: number;
  user: { login: string };
  /** Where the account creates API keys, for a Farm.js Infrastructure sign-in. */
  keysPage?: string;
}

export async function authorizePreviewGatewayPlan(
  plan: PreviewGatewayPlan,
  options: AuthorizePreviewPlanOptions = {},
): Promise<PreviewGatewayPlan> {
  const runtime = options.runtime || createDefaultPreviewAuthRuntime();
  const config = await loadPreviewAuthConfig(plan.gatewayUrl, runtime.fetch);

  if (!config.enabled) {
    return {
      ...plan,
      controlAuth: config.controlAuth ?? "bearer",
      ...(options.expiresInMs === undefined ? {} : { expiresInMs: options.expiresInMs }),
    };
  }
  if ((config.provider !== "github" && config.provider !== "device") || !config.clientId) {
    throw new Error("The Farm Preview gateway returned an unsupported login configuration.");
  }

  const environment = options.forceLogin ? undefined : previewCredentialFromEnvironment(config);
  let accountToken = options.forceLogin
    ? undefined
    : environment?.token || (await runtime.credentials.get(plan.gatewayUrl));
  if (!accountToken) {
    const account = await loginWithPreviewDeviceFlow(plan.gatewayUrl, config, runtime);
    accountToken = account.token;
    await finishPreviewSignIn(plan.gatewayUrl, account, runtime);
  }

  const expiresInMs =
    options.expiresInMs ?? (await runtime.promptDuration(config)) ?? config.defaultSessionTtlMs;
  let grant = await requestTunnelGrant(plan, accountToken, expiresInMs, runtime.fetch);

  if (grant.unauthorized) {
    if (environment) {
      throw new Error(
        `${environment.source} was rejected by the preview gateway. Replace or unset it before retrying.`,
      );
    }
    await runtime.credentials.delete(plan.gatewayUrl);
    const account = await loginWithPreviewDeviceFlow(plan.gatewayUrl, config, runtime);
    accountToken = account.token;
    await finishPreviewSignIn(plan.gatewayUrl, account, runtime);
    grant = await requestTunnelGrant(plan, accountToken, expiresInMs, runtime.fetch);
  }

  if (grant.unauthorized) {
    throw new Error("Farm Preview could not authorize this tunnel.");
  }

  return {
    ...plan,
    controlAuth: config.controlAuth ?? "bearer",
    relayToken: grant.token,
    expiresAt: grant.expiresAt,
    expiresInMs,
    ...(config.dashboardUrl ? { dashboardUrl: config.dashboardUrl } : {}),
  };
}

export async function loadPreviewAuthConfig(
  gatewayUrl: string,
  request: typeof fetch = fetch,
): Promise<PreviewAuthPublicConfig> {
  const response = await request(`${gatewayUrl}/api/auth/config`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    return {
      enabled: false,
      controlAuth: "query",
      defaultSessionTtlMs: 1000 * 60 * 30,
      maxSessionTtlMs: 1000 * 60 * 30,
    };
  }
  if (!response.ok) {
    throw new Error(
      `Farm Preview could not load the hosted login configuration (${response.status}).`,
    );
  }
  const config = (await response.json()) as PreviewAuthPublicConfig & {
    ok?: boolean;
    message?: string;
    createSession?: string;
  };
  if (
    config.ok === true &&
    config.message === "Farm Preview Gateway" &&
    config.createSession === "/api/sessions"
  ) {
    return {
      enabled: false,
      controlAuth: "query",
      defaultSessionTtlMs: 1000 * 60 * 30,
      maxSessionTtlMs: 1000 * 60 * 30,
    };
  }
  if (
    typeof config.enabled !== "boolean" ||
    (config.controlAuth !== undefined &&
      config.controlAuth !== "bearer" &&
      config.controlAuth !== "query") ||
    !Number.isSafeInteger(config.defaultSessionTtlMs) ||
    !Number.isSafeInteger(config.maxSessionTtlMs) ||
    config.defaultSessionTtlMs <= 0 ||
    config.maxSessionTtlMs <= 0 ||
    config.defaultSessionTtlMs > config.maxSessionTtlMs
  ) {
    throw new Error("The Farm Preview gateway returned an invalid login configuration.");
  }
  if (config.enabled && config.provider === "device" && safeAuthUrl(config.issuer || "").search)
    throw new Error("Invalid Farm Preview device issuer.");
  if (config.dashboardUrl && safeAuthUrl(config.dashboardUrl).search)
    throw new Error("Invalid Farm Preview dashboard URL.");
  return { ...config, controlAuth: config.controlAuth ?? "bearer" };
}

function safeAuthUrl(value: string, origin?: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.hash ||
    (origin && url.origin !== origin)
  )
    throw new Error("Farm Preview returned an unsafe authentication URL.");
  return url;
}

export type PreviewSignInMode = "github" | "infrastructure" | "none";

export interface PreviewSignInStatus {
  gatewayUrl: string;
  /** How the gateway signs people in; "none" for a gateway without sign-in. */
  mode: PreviewSignInMode;
  /** What farm preview would send. Undefined means it would ask for a browser sign-in. */
  using?: {
    source: PreviewEnvironmentCredential["source"] | "saved";
    /** The start of an API key, never the whole key. */
    hint?: string;
    login?: string;
    expiresAt?: number;
  };
  /** A saved sign-in exists, but an environment credential takes precedence. */
  savedOverridden: boolean;
  /** Why FARMJS_API_KEY is set but not used, when it is. */
  ignoredKey?: string;
}

/** Which credential farm preview would use for this gateway, from its public config only. */
export async function previewSignInStatus(
  gatewayUrl: string,
  runtime: PreviewAuthRuntime = createDefaultPreviewAuthRuntime(),
  env: Record<string, string | undefined> = process.env,
): Promise<PreviewSignInStatus> {
  const config = await loadPreviewAuthConfig(gatewayUrl, runtime.fetch);
  if (!config.enabled) return { gatewayUrl, mode: "none", savedOverridden: false };
  const mode = config.provider === "device" ? "infrastructure" : "github";
  // whoami reports the deprecation itself rather than warning.
  const environment = previewCredentialFromEnvironment(config, env, () => {});
  const saved = await runtime.credentials.get(gatewayUrl);
  const keyIgnored = !!env.FARMJS_API_KEY?.trim() && environment?.source !== "FARMJS_API_KEY";
  const status: PreviewSignInStatus = {
    gatewayUrl,
    mode,
    savedOverridden: !!environment && !!saved,
    ...(keyIgnored
      ? {
          ignoredKey:
            mode === "github"
              ? "this gateway uses GitHub sign-in, which doesn't accept API keys"
              : `it's for ${originOf(env.FARMJS_API_URL?.trim() || DEFAULT_INFRA_URL)}, but this gateway signs in through ${originOf(config.issuer)}. If the key is from there, set FARMJS_API_URL=${originOf(config.issuer)}`,
        }
      : {}),
  };
  if (environment) {
    status.using = {
      source: environment.source,
      ...(environment.source === "FARMJS_API_KEY"
        ? { hint: `${environment.token.slice(0, 11)}…` }
        : {}),
    };
  } else if (saved) {
    status.using = {
      source: "saved",
      ...(saved.startsWith("farmjs_") ? { hint: `${saved.slice(0, 11)}…` } : accountClaims(saved)),
    };
  }
  return status;
}

/** farm login: sign in to this gateway and save it, without starting a preview. */
export async function signInToPreviewGateway(
  gatewayUrl: string,
  runtime: PreviewAuthRuntime = createDefaultPreviewAuthRuntime(),
  /** @deprecated `root` is unused: sign-in no longer writes the app's .env. */
  _options: { root?: string } = {},
): Promise<{ login: string }> {
  const config = await loadPreviewAuthConfig(gatewayUrl, runtime.fetch);
  if (!config.enabled) throw new Error("This preview gateway doesn't use sign-in.");
  if ((config.provider !== "github" && config.provider !== "device") || !config.clientId) {
    throw new Error("The Farm Preview gateway returned an unsupported login configuration.");
  }
  const account = await loginWithPreviewDeviceFlow(gatewayUrl, config, runtime);
  await finishPreviewSignIn(gatewayUrl, account, runtime);
  return { login: account.user.login };
}

/**
 * Saves a new sign-in. The key farm login makes is for previews only, so it no longer
 * writes FARMJS_PROJECT_ID either: previews never read it, and analytics needs its own key.
 */
async function finishPreviewSignIn(
  gatewayUrl: string,
  account: PreviewAccountExchange,
  runtime: PreviewAuthRuntime,
) {
  await runtime.credentials.set(gatewayUrl, account.token);
  logger.success(`Signed in to Farm Preview as ${account.user.login}.`);
  if (account.keysPage) logger.info(previewKeyNote(account.keysPage));
}

/** What the farm login key is for, and where an analytics key comes from instead. */
export function previewKeyNote(keysPage: string) {
  return (
    "This key is for farm preview. To send analytics, create a Site analytics key on " +
    `the API keys page (${keysPage}) and set it as FARMJS_API_KEY where the app runs.`
  );
}

/** farm logout: forget this machine's saved sign-in. A saved API key stays valid in Infrastructure. */
export async function signOutOfPreviewGateway(
  gatewayUrl: string,
  runtime: Pick<PreviewAuthRuntime, "credentials"> = createDefaultPreviewAuthRuntime(),
): Promise<boolean> {
  if (!(await runtime.credentials.get(gatewayUrl))) return false;
  await runtime.credentials.delete(gatewayUrl);
  return true;
}

/** The login and expiry inside a GitHub sign-in account token, or undefined for any other token. */
function accountClaims(token: string): { login?: string; expiresAt?: number } | undefined {
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    if (claims?.kind !== "account") return undefined;
    return {
      ...(typeof claims.login === "string" ? { login: claims.login } : {}),
      ...(Number.isSafeInteger(claims.expiresAt) ? { expiresAt: claims.expiresAt } : {}),
    };
  } catch {
    // A Farm.js Infrastructure API key carries no claims.
    return undefined;
  }
}

/** The Better Auth base URL a device-mode gateway signs in through. */
function deviceIssuer(config: PreviewAuthPublicConfig) {
  const issuer = safeAuthUrl(config.issuer || "");
  if (issuer.search) throw new Error("Invalid Farm Preview device issuer.");
  return { origin: issuer.origin, base: issuer.href.replace(/\/$/, "") };
}

function originOf(value: string | undefined) {
  try {
    return new URL(value ?? "").origin;
  } catch {
    return String(value);
  }
}

async function loginWithPreviewDeviceFlow(
  gatewayUrl: string,
  config: PreviewAuthPublicConfig,
  runtime: PreviewAuthRuntime,
): Promise<PreviewAccountExchange> {
  if (runtime.interactive === false)
    throw new Error(
      config.provider === "device"
        ? "Farm Preview needs a credential in CI or a non-interactive terminal. Set FARMJS_API_KEY to a Farm.js Infrastructure API key (and FARMJS_API_URL if it isn't at https://app.farmjs.dev), or sign in once from an interactive terminal."
        : "This preview gateway only supports browser sign-in, so it can't sign in from CI or a non-interactive terminal. Run the command from an interactive terminal.",
    );
  if (config.provider === "github") return loginWithGitHubDeviceFlow(gatewayUrl, config, runtime);
  const issuer = deviceIssuer(config);
  const base = issuer.base;
  const post = (path: string, body: object) =>
    runtime.fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
  const response = await post("/device/code", { client_id: config.clientId });
  if (!response.ok)
    throw new Error(`Farm.js Infrastructure could not start sign-in (${response.status}).`);
  const device = (await response.json()) as GitHubDeviceAuthorization;
  if (
    typeof device.device_code !== "string" ||
    !device.device_code ||
    typeof device.user_code !== "string" ||
    !device.user_code ||
    !Number.isSafeInteger(device.expires_in) ||
    device.expires_in <= 0 ||
    device.expires_in > 3600 ||
    (device.interval !== undefined &&
      (!Number.isSafeInteger(device.interval) || device.interval < 1 || device.interval > 60))
  )
    throw new Error("Farm.js Infrastructure returned an invalid device authorization.");
  const browserUrl = safeAuthUrl(
    device.verification_uri_complete || device.verification_uri,
    issuer.origin,
  ).href;
  logger.info(`Confirm this code in Farm.js Infrastructure: ${device.user_code}`);
  logger.info(`Open: ${browserUrl}`);
  if (!(await runtime.openBrowser(browserUrl)))
    logger.warn("Open the URL above in your browser to continue.");
  logger.info("After approving this device, return here.");
  const deadline = Date.now() + device.expires_in * 1000;
  let interval = (device.interval ?? 5) * 1000;
  while (Date.now() < deadline) {
    await runtime.wait(interval);
    if (Date.now() >= deadline) break;
    const poll = await post("/device/token", {
      client_id: config.clientId,
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    // Infra rate-limits polling. The person may be approving right now, so wait as long as
    // it asks (capped at a minute) and keep polling until the code expires.
    if (poll.status === 429) {
      const retryAfter = Number(poll.headers.get("retry-after"));
      await runtime.wait(retryAfter > 0 ? Math.min(retryAfter, 60) * 1000 : interval);
      continue;
    }
    // A 5xx or an unreadable success body is a transient Infra or proxy failure, not an
    // answer: keep polling until the code expires.
    if (poll.status >= 500) continue;
    const result = (await poll.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    } | null;
    if (!result || typeof result !== "object") {
      if (poll.ok) continue;
      throw new Error(`Farm.js Infrastructure sign-in failed (${poll.status}). Try again.`);
    }
    if (
      poll.ok &&
      typeof result.access_token === "string" &&
      result.access_token &&
      Number.isSafeInteger(result.expires_in) &&
      result.expires_in! > 0
    ) {
      const deviceToken = result.access_token;
      const expiresAt = Date.now() + result.expires_in! * 1000;
      if (!(await runtime.confirm("Create an API key for this machine? (Y/n) ")))
        throw new PreviewApiKeyDeclinedError();
      const key = await createPreviewApiKey(issuer.origin, deviceToken, runtime.fetch);
      return {
        token: key,
        expiresAt,
        user: { login: "your Farm.js Infrastructure account" },
        keysPage: `${issuer.origin}/dashboard/settings`,
      };
    }
    if (poll.status === 400 && result.error === "authorization_pending") continue;
    if (poll.status === 400 && result.error === "slow_down") {
      interval += 5000;
      continue;
    }
    if (result.error === "access_denied")
      throw new Error("Farm.js Infrastructure sign-in was declined. Try again when ready.");
    if (result.error === "expired_token") break;
    throw new Error(`Farm.js Infrastructure sign-in failed (${poll.status}). Try again.`);
  }
  throw new Error("Farm.js Infrastructure sign-in expired. Try again to get a new code.");
}

/** Infrastructure turns the approved sign-in into an API key, the one credential the CLI keeps. */
async function createPreviewApiKey(origin: string, deviceToken: string, request: typeof fetch) {
  const response = await request(`${origin}/api/previews/key`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deviceToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({ name: `Farm CLI on ${hostname()}`.slice(0, 64) }),
    signal: AbortSignal.timeout(10_000),
    redirect: "error",
  });
  const body = (await response.json().catch(() => ({}))) as {
    key?: unknown;
    message?: unknown;
  };
  if (response.status === 201 && typeof body.key === "string" && body.key.startsWith("farmjs_"))
    return body.key;
  // 409: the account has as many keys as it can. 403: it left the organization it chose.
  throw new Error(
    (response.status === 409 || response.status === 403) &&
      typeof body.message === "string" &&
      body.message.trim()
      ? body.message
          .replace(/\p{Cc}/gu, " ")
          .trim()
          .slice(0, 300)
      : `Farm.js Infrastructure couldn't create an API key (${response.status}). Run farm login again.`,
  );
}

export function parsePreviewDuration(value: string | number | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error("Preview expiry must be a positive duration.");
    }
    return value;
  }
  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+)(m|h|d)$/);
  if (!match) {
    throw new Error('Preview expiry must use minutes, hours, or days, for example "30m" or "2h".');
  }
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 60_000 : match[2] === "h" ? 3_600_000 : 86_400_000;
  const duration = amount * multiplier;
  if (!Number.isSafeInteger(duration) || duration <= 0) {
    throw new Error("Preview expiry is outside the supported range.");
  }
  return duration;
}

export function formatPreviewExpiration(expiresAt: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(expiresAt));
}

async function requestTunnelGrant(
  plan: PreviewGatewayPlan,
  accountToken: string,
  expiresInMs: number,
  request: typeof fetch,
): Promise<{ token: string; expiresAt: number; unauthorized?: false } | { unauthorized: true }> {
  const response = await request(`${plan.gatewayUrl}/api/tunnel/grants`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accountToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ name: plan.requestedName, project: plan.project, expiresInMs }),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 401) {
    await response.body?.cancel();
    return { unauthorized: true };
  }
  if (!response.ok) {
    throw new Error(
      `Farm Preview rejected the tunnel grant (${response.status}): ${await response.text()}`,
    );
  }
  const grant = (await response.json()) as { token?: string; expiresAt?: number };
  if (
    !grant.token ||
    typeof grant.expiresAt !== "number" ||
    !Number.isSafeInteger(grant.expiresAt) ||
    grant.expiresAt <= Date.now() - PREVIEW_EXPIRY_CLOCK_SKEW_MS
  ) {
    throw new Error("Farm Preview returned an invalid tunnel grant.");
  }
  return { token: grant.token, expiresAt: grant.expiresAt as number };
}

async function loginWithGitHubDeviceFlow(
  gatewayUrl: string,
  config: PreviewAuthPublicConfig,
  runtime: PreviewAuthRuntime,
): Promise<PreviewAccountExchange> {
  const deviceResponse = await runtime.fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId || "",
      scope: config.scope || "read:user",
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!deviceResponse.ok) {
    throw new Error(`GitHub could not start Farm Preview sign-in (${deviceResponse.status}).`);
  }
  const device = (await deviceResponse.json()) as GitHubDeviceAuthorization;
  if (!device.device_code || !device.user_code || !device.verification_uri || !device.expires_in) {
    throw new Error("GitHub returned an invalid device authorization.");
  }

  const browserUrl = device.verification_uri_complete || device.verification_uri;
  logger.info("Sign in to Farm Preview in your browser.");
  logger.info(`Code: ${device.user_code}`);
  logger.info(`Open: ${browserUrl}`);
  if (!(await runtime.openBrowser(browserUrl))) {
    logger.warn("Could not open a browser automatically. Open the URL above to continue.");
  }

  const deadline = Date.now() + device.expires_in * 1000;
  let intervalMs = Math.max(1000, (device.interval || 5) * 1000);
  while (Date.now() < deadline) {
    await runtime.wait(intervalMs);
    const tokenResponse = await runtime.fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId || "",
        device_code: device.device_code,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) {
      throw new Error(`GitHub sign-in polling failed (${tokenResponse.status}).`);
    }
    const tokenResult = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (tokenResult.access_token) {
      return exchangePreviewAccount(gatewayUrl, tokenResult.access_token, runtime.fetch);
    }
    if (tokenResult.error === "authorization_pending") continue;
    if (tokenResult.error === "slow_down") {
      intervalMs += 5000;
      continue;
    }
    if (tokenResult.error === "expired_token") break;
    throw new Error(tokenResult.error_description || "GitHub sign-in was denied.");
  }
  throw new Error("GitHub sign-in expired before it was completed. Try again.");
}

async function exchangePreviewAccount(
  gatewayUrl: string,
  providerToken: string,
  request: typeof fetch,
) {
  const response = await request(`${gatewayUrl}/api/auth/exchange`, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ provider: "github", accessToken: providerToken }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(
      `Farm Preview could not finish sign-in (${response.status}): ${await response.text()}`,
    );
  }
  const account = (await response.json()) as PreviewAccountExchange;
  if (
    !account.token ||
    !account.user?.login ||
    !Number.isSafeInteger(account.expiresAt) ||
    account.expiresAt <= Date.now() - PREVIEW_EXPIRY_CLOCK_SKEW_MS
  ) {
    throw new Error("Farm Preview returned an invalid account credential.");
  }
  return account;
}

function createDefaultPreviewAuthRuntime(): PreviewAuthRuntime {
  return {
    interactive: !!process.stdin.isTTY && !process.env.CI,
    fetch,
    openBrowser,
    wait: (ms) => delay(ms),
    credentials: new FilePreviewCredentialStore(),
    promptDuration: promptPreviewDuration,
    confirm: confirmInTerminal,
  };
}

async function openBrowser(url: string) {
  safeAuthUrl(url);
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32.exe"
        : "xdg-open";
  // Do not interpolate device URLs into cmd.exe: query strings contain shell metacharacters.
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  try {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
      child.once("error", () => resolve(false));
    });
  } catch {
    return false;
  }
}

async function promptPreviewDuration(config: PreviewAuthPublicConfig) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  const defaultDuration = formatCompactPreviewDuration(config.defaultSessionTtlMs);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`Preview duration (${defaultDuration}): `);
    return answer.trim() ? parsePreviewDuration(answer) : config.defaultSessionTtlMs;
  } finally {
    prompt.close();
  }
}

async function confirmInTerminal(question: string) {
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return !/^\s*n/i.test(await prompt.question(question));
  } finally {
    prompt.close();
  }
}

class FilePreviewCredentialStore implements PreviewCredentialStore {
  private path =
    process.env.FARM_PREVIEW_CREDENTIALS_PATH ||
    join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "farm", "preview-auth.json");

  async get(gatewayUrl: string) {
    const credentials = await this.read();
    return credentials[credentialKey(gatewayUrl)];
  }

  async set(gatewayUrl: string, token: string) {
    const credentials = await this.read();
    credentials[credentialKey(gatewayUrl)] = token;
    await this.write(credentials);
  }

  async delete(gatewayUrl: string) {
    const credentials = await this.read();
    delete credentials[credentialKey(gatewayUrl)];
    await this.write(credentials);
  }

  private warnedUnreadable = false;

  private async read(): Promise<Record<string, string>> {
    let source: string;
    try {
      source = await readFile(this.path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    try {
      const value = JSON.parse(source);
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch {
      // A damaged file holds no usable sign-in. Treat it as signed out so farm login
      // (or a preview that signs in) can replace it.
      if (!this.warnedUnreadable) {
        this.warnedUnreadable = true;
        logger.warn(
          `Ignoring unreadable Farm Preview credentials at ${this.path}. Run farm login to replace them.`,
        );
      }
      return {};
    }
  }

  private async write(credentials: Record<string, string>) {
    const directory = dirname(this.path);
    // Only tighten a directory this store created; an existing one (for example a custom
    // FARM_PREVIEW_CREDENTIALS_PATH in a shared folder) keeps its owner's permissions.
    const created = await mkdir(directory, { recursive: true, mode: 0o700 });
    if (created !== undefined) await chmod(directory, 0o700);
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
      await rename(temporary, this.path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

function credentialKey(gatewayUrl: string) {
  return new URL(gatewayUrl).origin;
}
