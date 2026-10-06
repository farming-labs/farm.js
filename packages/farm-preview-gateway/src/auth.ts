import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface PreviewManagedAuthOptions {
  /** Secret used to sign account tokens and one-preview tunnel grants. */
  signingSecret: string;
  /** Public client id for the Farming Labs GitHub OAuth app. */
  githubClientId?: string;
  /** First-party device login. Omit to preserve GitHub account authentication. */
  deviceAuth?: {
    issuer: string;
    clientId: string;
    /** Resolve an API key or approved device credential on every new grant. */
    authorizeAccount(
      token: string,
    ): Promise<{
      subject: string;
      login: string;
      expiresAt?: number;
      keyId?: string;
      project?: string;
    } | null>;
  };
  /** Public console URL. Must not contain credentials or query parameters. */
  dashboardUrl?: string;
  accountTokenTtlMs?: number;
  defaultSessionTtlMs?: number;
  maxSessionTtlMs?: number;
  githubApiUrl?: string;
  fetch?: typeof fetch;
  /**
   * Shared abuse-control hook for provider-token exchange and, in device mode,
   * account credential verification on the tunnel-grant endpoint.
   * Implementations must not consume the request body. Failures reject the
   * exchange with a retryable 503 response instead of bypassing the limiter.
   */
  rateLimitExchange?: PreviewAuthExchangeRateLimiter;
}

export interface PreviewAuthExchangeRateLimitResult {
  allowed: boolean;
  /** How long the caller should wait before retrying a rejected exchange. */
  retryAfterMs?: number;
}

export type PreviewAuthExchangeRateLimiter = (
  request: Request,
) => PreviewAuthExchangeRateLimitResult | Promise<PreviewAuthExchangeRateLimitResult>;

export interface PreviewAccountIdentity {
  /** Optional credential restriction; never taken from the grant request. */
  project?: string;
  /** Non-secret identifier supplied by the credential verifier, never the CLI. */
  keyId?: string;
  provider: "github" | "device";
  subject: string;
  login: string;
  name?: string;
  avatarUrl?: string;
}

export interface PreviewAccountClaims extends PreviewAccountIdentity {
  kind: "account";
  issuedAt: number;
  expiresAt: number;
}

export interface PreviewTunnelGrantClaims {
  /** Unique signed grant identity, used to revoke reconnects across transports. */
  nonce?: string;
  project?: string;
  keyId?: string;
  kind: "tunnel";
  /** Absent on older GitHub grants. */
  provider?: "github" | "device";
  subject: string;
  login: string;
  name: string;
  issuedAt: number;
  expiresAt: number;
}

export interface PreviewTunnelGrant {
  token: string;
  name: string;
  expiresAt: number;
}

const TOKEN_PREFIX = "farm_preview_v1";
const DEFAULT_ACCOUNT_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60;
const DEFAULT_MAX_SESSION_TTL_MS = 1000 * 60 * 60 * 24;
const MIN_SESSION_TTL_MS = 1000 * 60;
const MAX_CLOCK_SKEW_MS = 1000 * 60 * 5;

export function getPreviewAuthPublicConfig(options: PreviewManagedAuthOptions) {
  validatePreviewAuthOptions(options);
  const durations = resolvePreviewDurations(options);
  return {
    enabled: true as const,
    controlAuth: "bearer" as const,
    ...(options.deviceAuth
      ? {
          provider: "device" as const,
          clientId: options.deviceAuth.clientId,
          issuer: options.deviceAuth.issuer,
        }
      : { provider: "github" as const, clientId: options.githubClientId, scope: "read:user" }),
    ...(options.dashboardUrl ? { dashboardUrl: options.dashboardUrl } : {}),
    defaultSessionTtlMs: durations.defaultSessionTtlMs,
    maxSessionTtlMs: durations.maxSessionTtlMs,
  };
}

export async function exchangeGitHubPreviewToken(
  providerToken: string,
  options: PreviewManagedAuthOptions,
): Promise<{ token: string; expiresAt: number; user: PreviewAccountIdentity }> {
  validatePreviewAuthOptions(options);
  if (options.deviceAuth)
    throw new PreviewAuthError(400, "Use the configured device sign-in flow.");
  if (!providerToken || providerToken.length > 4096) {
    throw new PreviewAuthError(400, "A GitHub access token is required.");
  }

  const request = options.fetch || fetch;
  const response = await request(`${options.githubApiUrl || "https://api.github.com"}/user`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${providerToken}`,
      "user-agent": "farm-preview-gateway",
      "x-github-api-version": "2026-03-10",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new PreviewAuthError(401, "GitHub could not verify this Farm Preview login.");
  }

  const profile = (await response.json()) as {
    id?: number;
    login?: string;
    name?: string | null;
    avatar_url?: string;
  };
  if (!Number.isSafeInteger(profile.id) || !profile.login) {
    throw new PreviewAuthError(502, "GitHub returned an invalid user profile.");
  }

  const now = Date.now();
  const expiresAt = now + (options.accountTokenTtlMs ?? DEFAULT_ACCOUNT_TOKEN_TTL_MS);
  const user: PreviewAccountIdentity = {
    provider: "github",
    subject: String(profile.id),
    login: profile.login,
    ...(profile.name ? { name: profile.name } : {}),
    ...(profile.avatar_url ? { avatarUrl: profile.avatar_url } : {}),
  };
  const claims: PreviewAccountClaims = {
    kind: "account",
    ...user,
    issuedAt: now,
    expiresAt,
  };

  return {
    token: signPreviewClaims(claims, options.signingSecret),
    expiresAt,
    user,
  };
}

export function verifyPreviewAccountToken(
  token: string,
  options: Pick<PreviewManagedAuthOptions, "signingSecret">,
): PreviewAccountClaims {
  const claims = verifyPreviewClaims(token, options.signingSecret);
  if (
    claims.kind !== "account" ||
    claims.provider !== "github" ||
    typeof claims.subject !== "string" ||
    typeof claims.login !== "string"
  ) {
    throw new PreviewAuthError(401, "The Farm Preview account token is invalid.");
  }
  return claims as unknown as PreviewAccountClaims;
}

export function issuePreviewTunnelGrant(
  account: PreviewAccountClaims,
  input: { name: string; project?: string; expiresInMs?: number },
  options: PreviewManagedAuthOptions,
): PreviewTunnelGrant {
  validatePreviewAuthOptions(options);
  const durations = resolvePreviewDurations(options);
  if (
    input.project !== undefined &&
    (typeof input.project !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(input.project))
  )
    throw new PreviewAuthError(400, "Preview project must be a lowercase slug of 1–63 characters.");
  if (
    input.expiresInMs !== undefined &&
    (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs <= 0)
  ) {
    throw new PreviewAuthError(400, "Preview expiry must be a positive integer.");
  }
  const requestedTtlMs = input.expiresInMs ?? durations.defaultSessionTtlMs;
  if (account.project !== undefined && account.project !== (input.project ?? input.name))
    throw new PreviewAuthError(403, "This API key is restricted to another preview project.");
  const ttlMs = Math.max(MIN_SESSION_TTL_MS, Math.min(durations.maxSessionTtlMs, requestedTtlMs));
  const issuedAt = Date.now();
  const expiresAt = Math.min(issuedAt + ttlMs, account.expiresAt);
  if (expiresAt <= issuedAt) throw new PreviewAuthError(401, "The account credential has expired.");
  const claims: PreviewTunnelGrantClaims & { nonce: string } = {
    kind: "tunnel",
    provider: account.provider,
    subject: account.subject,
    login: account.login,
    name: input.name,
    project: input.project ?? input.name,
    ...(account.keyId ? { keyId: account.keyId } : {}),
    issuedAt,
    expiresAt,
    nonce: randomUUID(),
  };
  return {
    token: signPreviewClaims(claims, options.signingSecret),
    name: input.name,
    expiresAt,
  };
}

export function verifyPreviewTunnelGrant(
  token: string,
  options: Pick<PreviewManagedAuthOptions, "signingSecret"> & { name?: string },
): PreviewTunnelGrantClaims {
  const claims = verifyPreviewClaims(token, options.signingSecret);
  if (
    claims.kind !== "tunnel" ||
    typeof claims.subject !== "string" ||
    typeof claims.login !== "string" ||
    typeof claims.name !== "string" ||
    (claims.nonce !== undefined &&
      (typeof claims.nonce !== "string" || !/^[\w-]{1,128}$/.test(claims.nonce))) ||
    (claims.project !== undefined &&
      (typeof claims.project !== "string" || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(claims.project))) ||
    (claims.keyId !== undefined &&
      (typeof claims.keyId !== "string" || !/^[\w-]{1,128}$/.test(claims.keyId))) ||
    (options.name !== undefined && claims.name !== options.name)
  ) {
    throw new PreviewAuthError(401, "The Farm Preview tunnel grant is invalid.");
  }
  return claims as unknown as PreviewTunnelGrantClaims;
}

export function readPreviewBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get("authorization");
  if (!authorization || !/^Bearer /i.test(authorization)) return undefined;
  const token = authorization.slice(7).trim();
  return token || undefined;
}

export class PreviewAuthError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function resolvePreviewDurations(options: PreviewManagedAuthOptions) {
  const maxSessionTtlMs = Math.max(
    MIN_SESSION_TTL_MS,
    options.maxSessionTtlMs ?? DEFAULT_MAX_SESSION_TTL_MS,
  );
  return {
    maxSessionTtlMs,
    defaultSessionTtlMs: Math.min(
      maxSessionTtlMs,
      Math.max(MIN_SESSION_TTL_MS, options.defaultSessionTtlMs ?? DEFAULT_SESSION_TTL_MS),
    ),
  };
}

function validatePreviewAuthOptions(options: PreviewManagedAuthOptions) {
  if (Buffer.byteLength(options.signingSecret) < 32) {
    throw new Error("Farm Preview auth signingSecret must contain at least 32 bytes.");
  }
  if (!options.githubClientId && !options.deviceAuth) {
    throw new Error("Farm Preview auth requires a GitHub OAuth client id or deviceAuth.");
  }
  if (options.deviceAuth) {
    validatePublicAuthUrl(options.deviceAuth.issuer);
    if (!options.deviceAuth.clientId)
      throw new Error("Farm Preview deviceAuth requires a clientId.");
  }
  if (options.dashboardUrl) validatePublicAuthUrl(options.dashboardUrl);
  for (const [name, value] of [
    ["accountTokenTtlMs", options.accountTokenTtlMs],
    ["defaultSessionTtlMs", options.defaultSessionTtlMs],
    ["maxSessionTtlMs", options.maxSessionTtlMs],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
      throw new Error(`Farm Preview auth ${name} must be a positive integer.`);
    }
  }
}

function validatePublicAuthUrl(value: string) {
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(local && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "Farm Preview auth URLs must use HTTPS (HTTP only for loopback development), without credentials, queries or fragments.",
    );
  }
}

export async function authorizePreviewAccount(
  token: string,
  options: PreviewManagedAuthOptions,
): Promise<PreviewAccountClaims> {
  if (!options.deviceAuth) return verifyPreviewAccountToken(token, options);
  if (!token || token.length > 4096) throw new PreviewAuthError(401, "Invalid preview credential.");
  let account;
  try {
    account = await options.deviceAuth.authorizeAccount(token);
  } catch {
    throw new PreviewAuthError(503, "Farm Preview authentication is temporarily unavailable.");
  }
  const now = Date.now();
  if (
    !account ||
    typeof account.subject !== "string" ||
    !account.subject ||
    typeof account.login !== "string" ||
    !account.login ||
    (account.project !== undefined &&
      (typeof account.project !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,62}$/.test(account.project))) ||
    (account.keyId !== undefined &&
      (typeof account.keyId !== "string" || !/^[\w-]{1,128}$/.test(account.keyId))) ||
    (account.expiresAt !== undefined &&
      (!Number.isSafeInteger(account.expiresAt) || account.expiresAt <= now))
  ) {
    throw new PreviewAuthError(401, "The Farm Infra credential is invalid or expired.");
  }
  return {
    kind: "account",
    provider: "device",
    subject: account.subject,
    login: account.login,
    ...(account.keyId ? { keyId: account.keyId } : {}),
    ...(account.project ? { project: account.project } : {}),
    issuedAt: now,
    expiresAt: account.expiresAt ?? now + DEFAULT_ACCOUNT_TOKEN_TTL_MS,
  };
}

function signPreviewClaims(claims: object, secret: string) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(`${TOKEN_PREFIX}.${payload}`)
    .digest("base64url");
  return `${TOKEN_PREFIX}.${payload}.${signature}`;
}

function verifyPreviewClaims(token: string, secret: string): Record<string, unknown> {
  if (!token || token.length > 16_384) {
    throw new PreviewAuthError(401, "The Farm Preview credential is invalid.");
  }
  const [prefix, payload, presentedSignature, ...rest] = token.split(".");
  if (prefix !== TOKEN_PREFIX || !payload || !presentedSignature || rest.length) {
    throw new PreviewAuthError(401, "The Farm Preview credential is invalid.");
  }

  const expectedSignature = createHmac("sha256", secret)
    .update(`${TOKEN_PREFIX}.${payload}`)
    .digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(presentedSignature, "base64url");
  } catch {
    throw new PreviewAuthError(401, "The Farm Preview credential is invalid.");
  }
  if (
    presented.length !== expectedSignature.length ||
    !timingSafeEqual(presented, expectedSignature)
  ) {
    throw new PreviewAuthError(401, "The Farm Preview credential is invalid.");
  }

  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw new PreviewAuthError(401, "The Farm Preview credential is invalid.");
  }
  if (
    typeof claims !== "object" ||
    claims === null ||
    Array.isArray(claims) ||
    !("issuedAt" in claims) ||
    !("expiresAt" in claims) ||
    !Number.isSafeInteger(claims.issuedAt) ||
    !Number.isSafeInteger(claims.expiresAt) ||
    Number(claims.issuedAt) > Date.now() + MAX_CLOCK_SKEW_MS ||
    Number(claims.expiresAt) <= Date.now()
  ) {
    throw new PreviewAuthError(401, "The Farm Preview credential has expired or is invalid.");
  }
  return claims as Record<string, unknown>;
}
