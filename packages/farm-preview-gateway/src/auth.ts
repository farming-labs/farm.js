import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export interface PreviewManagedAuthOptions {
  /** Secret used to sign account tokens and one-preview tunnel grants. */
  signingSecret: string;
  /** Public client id for the Farming Labs GitHub OAuth app. */
  githubClientId: string;
  accountTokenTtlMs?: number;
  defaultSessionTtlMs?: number;
  maxSessionTtlMs?: number;
  githubApiUrl?: string;
  fetch?: typeof fetch;
  /**
   * Shared abuse-control hook for the provider-token exchange endpoint.
   * Implementations must not consume the request body.
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
  provider: "github";
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
  kind: "tunnel";
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
    provider: "github" as const,
    clientId: options.githubClientId,
    scope: "read:user",
    defaultSessionTtlMs: durations.defaultSessionTtlMs,
    maxSessionTtlMs: durations.maxSessionTtlMs,
  };
}

export async function exchangeGitHubPreviewToken(
  providerToken: string,
  options: PreviewManagedAuthOptions,
): Promise<{ token: string; expiresAt: number; user: PreviewAccountIdentity }> {
  validatePreviewAuthOptions(options);
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
  input: { name: string; expiresInMs?: number },
  options: PreviewManagedAuthOptions,
): PreviewTunnelGrant {
  validatePreviewAuthOptions(options);
  const durations = resolvePreviewDurations(options);
  if (
    input.expiresInMs !== undefined &&
    (!Number.isSafeInteger(input.expiresInMs) || input.expiresInMs <= 0)
  ) {
    throw new PreviewAuthError(400, "Preview expiry must be a positive integer.");
  }
  const requestedTtlMs = input.expiresInMs ?? durations.defaultSessionTtlMs;
  const ttlMs = Math.max(MIN_SESSION_TTL_MS, Math.min(durations.maxSessionTtlMs, requestedTtlMs));
  const issuedAt = Date.now();
  const expiresAt = issuedAt + ttlMs;
  const claims: PreviewTunnelGrantClaims & { nonce: string } = {
    kind: "tunnel",
    subject: account.subject,
    login: account.login,
    name: input.name,
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
  if (!options.githubClientId) {
    throw new Error("Farm Preview auth requires a GitHub OAuth client id.");
  }
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
