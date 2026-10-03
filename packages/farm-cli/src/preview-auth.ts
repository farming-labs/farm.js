import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createInterface } from "node:readline/promises";
import { logger } from "@farm.js/core";
import type { PreviewGatewayPlan } from "./preview-gateway";
import { formatCompactPreviewDuration } from "./preview-duration";

export const PREVIEW_EXPIRY_CLOCK_SKEW_MS = 1000 * 60 * 5;

export interface PreviewAuthPublicConfig {
  enabled: boolean;
  controlAuth?: "bearer" | "query";
  provider?: "github";
  clientId?: string;
  scope?: string;
  defaultSessionTtlMs: number;
  maxSessionTtlMs: number;
}

export interface AuthorizePreviewPlanOptions {
  expiresInMs?: number;
  forceLogin?: boolean;
  runtime?: PreviewAuthRuntime;
}

export interface PreviewAuthRuntime {
  fetch: typeof fetch;
  openBrowser(url: string): Promise<boolean>;
  wait(ms: number): Promise<void>;
  credentials: PreviewCredentialStore;
  promptDuration(config: PreviewAuthPublicConfig): Promise<number | undefined>;
}

export interface PreviewCredentialStore {
  get(gatewayUrl: string): Promise<string | undefined>;
  set(gatewayUrl: string, token: string): Promise<void>;
  delete(gatewayUrl: string): Promise<void>;
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
  if (config.provider !== "github" || !config.clientId) {
    throw new Error("The Farm Preview gateway returned an unsupported login configuration.");
  }

  let accountToken = options.forceLogin
    ? undefined
    : process.env.FARM_PREVIEW_TOKEN || (await runtime.credentials.get(plan.gatewayUrl));
  if (!accountToken) {
    const account = await loginWithGitHubDeviceFlow(plan.gatewayUrl, config, runtime);
    accountToken = account.token;
    await runtime.credentials.set(plan.gatewayUrl, accountToken);
    logger.success(`Signed in to Farm Preview as ${account.user.login}.`);
  }

  const expiresInMs =
    options.expiresInMs ?? (await runtime.promptDuration(config)) ?? config.defaultSessionTtlMs;
  let grant = await requestTunnelGrant(plan, accountToken, expiresInMs, runtime.fetch);

  if (grant.unauthorized) {
    if (process.env.FARM_PREVIEW_TOKEN && !options.forceLogin) {
      throw new Error(
        "FARM_PREVIEW_TOKEN was rejected by the hosted gateway. Replace or unset it before retrying.",
      );
    }
    if (!process.env.FARM_PREVIEW_TOKEN) await runtime.credentials.delete(plan.gatewayUrl);
    const account = await loginWithGitHubDeviceFlow(plan.gatewayUrl, config, runtime);
    accountToken = account.token;
    await runtime.credentials.set(plan.gatewayUrl, accountToken);
    logger.success(`Signed in to Farm Preview as ${account.user.login}.`);
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
  return { ...config, controlAuth: config.controlAuth ?? "bearer" };
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
    body: JSON.stringify({ name: plan.requestedName, expiresInMs }),
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
  throw new Error("GitHub sign-in expired before it was completed. Run farm preview again.");
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
    fetch,
    openBrowser,
    wait: (ms) => delay(ms),
    credentials: new FilePreviewCredentialStore(),
    promptDuration: promptPreviewDuration,
  };
}

async function openBrowser(url: string) {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
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

  private async read(): Promise<Record<string, string>> {
    try {
      const value = JSON.parse(await readFile(this.path, "utf8"));
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }

  private async write(credentials: Record<string, string>) {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
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
