import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import {
  authorizePreviewAccount,
  exchangeGitHubPreviewToken,
  getPreviewAuthPublicConfig,
  issuePreviewTunnelGrant,
  PreviewAuthError,
  readPreviewBearerToken,
  verifyPreviewAccountToken,
  verifyPreviewTunnelGrant,
  type PreviewAuthExchangeRateLimitResult,
  type PreviewManagedAuthOptions,
} from "./auth.js";

export {
  exchangeGitHubPreviewToken,
  getPreviewAuthPublicConfig,
  issuePreviewTunnelGrant,
  PreviewAuthError,
  readPreviewBearerToken,
  verifyPreviewAccountToken,
  verifyPreviewTunnelGrant,
  type PreviewAccountClaims,
  type PreviewAuthExchangeRateLimiter,
  type PreviewAuthExchangeRateLimitResult,
  type PreviewAccountIdentity,
  type PreviewManagedAuthOptions,
  type PreviewTunnelGrant,
  type PreviewTunnelGrantClaims,
} from "./auth.js";

export interface PreviewSessionAccess {
  id: string;
  name: string;
  ownerId?: string;
  project?: string;
  keyId?: string;
  grantId?: string;
  expiresAt?: number;
}

export interface PreviewGatewayOptions {
  /** Required access control when supplied. Denials and errors fail closed, unlike telemetry. */
  authorizeSession?: (session: PreviewSessionAccess) => Promise<boolean>;
  /** Optional metadata-only telemetry. Failures never interrupt a preview. */
  observer?: PreviewGatewayObserver;
  domain?: string;
  baseUrl?: string;
  store?: PreviewGatewayStore;
  sessionTtlMs?: number;
  clientHeartbeatTimeoutMs?: number;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  maxBodyBytes?: number;
  maxResponseBodyBytes?: number;
  /** Managed account login and one-preview grant configuration. */
  auth?: PreviewManagedAuthOptions;
}

export interface PreviewGatewaySession {
  grantId?: string;
  project?: string;
  keyId?: string;
  ownerId?: string;
  id: string;
  name: string;
  hostname: string;
  publicUrl: string;
  token: string;
  localUrl?: string;
  createdAt: number;
  expiresAt: number;
  /** Internal idle expiry marker. Missing means expiresAt is an absolute cap. */
  slidingExpiration?: true;
  lastHeartbeatAt?: number;
}

export interface PreviewGatewayRequest {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string | null;
  encoding?: "base64";
  createdAt: number;
  cancelled?: true;
}

export interface PreviewGatewayResponse {
  status: number;
  // A header may carry multiple values (notably Set-Cookie: a login response
  // commonly sets a session cookie and a CSRF cookie). Those must survive as
  // an array through the store and back onto the public response.
  headers?: Record<string, string | string[]>;
  body?: string | null;
  encoding?: "base64";
}

export interface PreviewGatewayStore {
  createSession(session: PreviewGatewaySession, ttlMs: number): Promise<void>;
  getSessionByName(name: string): Promise<PreviewGatewaySession | undefined>;
  getSessionById(id: string): Promise<PreviewGatewaySession | undefined>;
  touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void>;
  enqueueRequest(sessionId: string, request: PreviewGatewayRequest, ttlMs: number): Promise<void>;
  takeRequests(sessionId: string, limit: number): Promise<PreviewGatewayRequest[]>;
  saveResponse(
    sessionId: string,
    requestId: string,
    response: PreviewGatewayResponse,
    ttlMs: number,
  ): Promise<void>;
  getResponse(sessionId: string, requestId: string): Promise<PreviewGatewayResponse | undefined>;
  deleteResponse(sessionId: string, requestId: string): Promise<void>;
  deleteSession(session: PreviewGatewaySession): Promise<void>;
}

interface PreviewGatewayRuntimeConfig {
  authorizeSession?: PreviewGatewayOptions["authorizeSession"];
  observer?: PreviewGatewayObserver;
  domain: string;
  baseUrl?: string;
  sessionTtlMs: number;
  clientHeartbeatTimeoutMs: number;
  requestTimeoutMs: number;
  pollTimeoutMs: number;
  pollIntervalMs: number;
  maxBodyBytes: number;
  maxResponseBodyBytes: number;
  auth?: PreviewManagedAuthOptions;
}

export interface PreviewGatewayObserver {
  session?(event: {
    grantId?: string;
    project?: string;
    keyId?: string;
    id: string;
    name: string;
    ownerId?: string;
    publicUrl: string;
    expiresAt?: number;
    state: "connected" | "disconnected";
    at: number;
  }): void | Promise<void>;
  request?(event: {
    sessionId: string;
    method: string;
    path: string;
    status: number;
    durationMs: number;
    at: number;
  }): void | Promise<void>;
}

function observe(callback: (() => void | Promise<void>) | undefined) {
  if (!callback) return;
  try {
    void Promise.resolve(callback()).catch(() => undefined);
  } catch {
    /* Optional telemetry. */
  }
}

function reportSession(
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
  state: "connected" | "disconnected",
) {
  if (!config.observer?.session) return;
  observe(() =>
    config.observer!.session!({
      id: session.id,
      grantId: session.grantId,
      name: session.name,
      project: session.project,
      keyId: session.keyId,
      ownerId: session.ownerId,
      publicUrl: session.publicUrl,
      expiresAt: session.expiresAt,
      state,
      at: Date.now(),
    }),
  );
}

const DEFAULT_DOMAIN = "preview.farmjs.dev";
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 30;
const DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS = 1000 * 20;
const DEFAULT_REQUEST_TIMEOUT_MS = 25000;
const DEFAULT_POLL_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 * 5;
const DEFAULT_MAX_RESPONSE_BODY_BYTES = 1024 * 1024 * 5;
const DEFAULT_POLL_REQUEST_LIMIT = 50;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getHopByHopHeaderNames(headers: Headers | Record<string, string | string[]>): Set<string> {
  const names = new Set(HOP_BY_HOP_HEADERS);
  const connection =
    headers instanceof Headers
      ? headers.get("connection")
      : Object.entries(headers).find(([name]) => name.toLowerCase() === "connection")?.[1];
  const values = Array.isArray(connection) ? connection : connection ? [connection] : [];
  for (const value of values) {
    for (const name of value.split(",")) {
      const normalized = name.trim().toLowerCase();
      if (normalized) names.add(normalized);
    }
  }
  return names;
}

/**
 * A gateway request handler, plus the name-ownership probe another preview
 * transport needs before it claims the same public hostname.
 */
export type PreviewGatewayHandler = ((request: Request) => Promise<Response>) & {
  isPreviewNameClaimed(name: string): Promise<boolean>;
};

export type NodePreviewGatewayHandler = ((
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void>) & {
  isPreviewNameClaimed(name: string): Promise<boolean>;
};

export function createPreviewGatewayHandler(
  options: PreviewGatewayOptions = {},
): PreviewGatewayHandler {
  if (options.auth) getPreviewAuthPublicConfig(options.auth);
  const store = options.store || createPreviewGatewayStoreFromEnv();
  const config = {
    authorizeSession: options.authorizeSession,
    observer: options.observer,
    domain: normalizeDomain(options.domain || process.env.FARM_PREVIEW_DOMAIN || DEFAULT_DOMAIN),
    baseUrl: options.baseUrl || process.env.FARM_PREVIEW_GATEWAY_URL,
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    clientHeartbeatTimeoutMs:
      options.clientHeartbeatTimeoutMs ?? DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    maxResponseBodyBytes: options.maxResponseBodyBytes ?? DEFAULT_MAX_RESPONSE_BODY_BYTES,
    auth: options.auth,
  };

  const handlePreviewGatewayRequest = async function handlePreviewGatewayRequest(
    request: Request,
  ): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          ok: true,
          domain: config.domain,
          store: store.constructor.name || "PreviewGatewayStore",
        });
      }

      if (request.method === "GET" && url.pathname === "/api/auth/config") {
        return json(
          config.auth
            ? getPreviewAuthPublicConfig(config.auth)
            : {
                enabled: false,
                controlAuth: "bearer",
                defaultSessionTtlMs: config.sessionTtlMs,
                maxSessionTtlMs: config.sessionTtlMs,
              },
        );
      }

      if (request.method === "POST" && url.pathname === "/api/auth/exchange") {
        if (!config.auth) return text("Managed preview authentication is not configured.", 404);
        const rateLimitResponse = await limitPreviewAccountExchange(request, config.auth);
        if (rateLimitResponse) return rateLimitResponse;
        return await exchangePreviewAccount(request, config.auth);
      }

      if (request.method === "POST" && url.pathname === "/api/tunnel/grants") {
        if (!config.auth) return text("Managed preview authentication is not configured.", 404);
        if (config.auth.deviceAuth) {
          const limited = await limitPreviewAccountExchange(request, config.auth);
          if (limited) return limited;
        }
        return await createTunnelGrant(request, config.auth);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions") {
        return await createSession(request, store, config);
      }

      const sessionRoute = matchSessionRoute(url.pathname);
      if (sessionRoute) {
        return await handleSessionRoute(request, url, store, config, sessionRoute);
      }

      const publicRoute = resolvePublicPreviewRoute(request, url, config.domain);
      if (publicRoute) {
        return await proxyPublicRequest(request, url, store, config, publicRoute);
      }

      return json(
        {
          ok: true,
          message: "Farm Preview Gateway",
          createSession: "/api/sessions",
          health: "/api/health",
        },
        200,
      );
    } catch (error) {
      if (error instanceof GatewayHttpError || error instanceof PreviewAuthError) {
        return text(error.message, error.status);
      }
      return text(
        error instanceof Error ? error.message : "Unexpected preview gateway error.",
        500,
      );
    }
  };

  // The persistent relay serves the same public hostnames from a separate name
  // namespace, and its route wins over this handler, so it has to be able to
  // ask whether a live polling session already owns a name before accepting a
  // claim for it.
  return Object.assign(handlePreviewGatewayRequest, {
    async isPreviewNameClaimed(name: string) {
      const claimed = sanitizePreviewName(name);
      if (!claimed) return false;
      const session = await store.getSessionByName(claimed);
      return Boolean(session && isPreviewClientOnline(session, config));
    },
  });
}

async function limitPreviewAccountExchange(request: Request, auth: PreviewManagedAuthOptions) {
  if (!auth.rateLimitExchange) return undefined;
  let result: PreviewAuthExchangeRateLimitResult;
  try {
    result = await auth.rateLimitExchange(request);
  } catch {
    return new Response("Farm Preview login is temporarily unavailable. Try again shortly.", {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
        "retry-after": "1",
      },
    });
  }
  if (result.allowed) return undefined;

  const retryAfterMs =
    Number.isFinite(result.retryAfterMs) && (result.retryAfterMs ?? 0) > 0
      ? result.retryAfterMs!
      : 1000;
  return new Response("Too many Farm Preview login attempts. Try again shortly.", {
    status: 429,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "retry-after": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
    },
  });
}

async function exchangePreviewAccount(request: Request, auth: PreviewManagedAuthOptions) {
  const input = (await request.json().catch(() => ({}))) as {
    provider?: string;
    accessToken?: string;
  };
  if (input.provider !== "github") {
    throw new PreviewAuthError(400, "Farm Preview currently supports GitHub sign-in.");
  }
  return json(await exchangeGitHubPreviewToken(input.accessToken || "", auth));
}

async function createTunnelGrant(request: Request, auth: PreviewManagedAuthOptions) {
  const accountToken = readPreviewBearerToken(request);
  if (!accountToken) {
    throw new PreviewAuthError(401, "Sign in with Farm Preview before creating a tunnel grant.");
  }
  const account = await authorizePreviewAccount(accountToken, auth);
  const input = (await request.json().catch(() => ({}))) as {
    name?: string;
    project?: string;
    expiresInMs?: number;
  };
  const name = sanitizePreviewName(input.name);
  if (!name) throw new PreviewAuthError(400, "A valid preview name is required.");

  return json(
    issuePreviewTunnelGrant(
      account,
      {
        name,
        project: input.project,
        ...(input.expiresInMs !== undefined ? { expiresInMs: input.expiresInMs } : {}),
      },
      auth,
    ),
  );
}

export function createNodePreviewGatewayHandler(
  options: PreviewGatewayOptions = {},
): NodePreviewGatewayHandler {
  const handler = createPreviewGatewayHandler(options);

  const nodePreviewGatewayHandler = async function nodePreviewGatewayHandler(
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const abortOnClose = () => {
      if (!res.writableEnded) abort();
    };
    req.once("aborted", abort);
    res.once("close", abortOnClose);
    try {
      const response = await handler(nodeRequestToWebRequest(req, controller.signal));
      if (controller.signal.aborted || res.destroyed) {
        await response.body?.cancel();
        return;
      }
      res.statusCode = response.status;
      // Headers.forEach folds repeated headers into one comma-joined value, which
      // corrupts multiple Set-Cookie. Emit those separately as an array so each
      // cookie becomes its own header line.
      const setCookies = response.headers.getSetCookie?.() ?? [];
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() === "set-cookie") return;
        res.setHeader(key, value);
      });
      if (setCookies.length > 0) {
        res.setHeader("set-cookie", setCookies);
      }
      res.end(Buffer.from(await response.arrayBuffer()));
    } finally {
      req.off("aborted", abort);
      res.off("close", abortOnClose);
    }
  };

  return Object.assign(nodePreviewGatewayHandler, {
    isPreviewNameClaimed: handler.isPreviewNameClaimed,
  });
}

export function createPreviewGatewayStoreFromEnv(): PreviewGatewayStore {
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (redisUrl && redisToken) {
    return new RedisRestPreviewGatewayStore({
      url: redisUrl,
      token: redisToken,
    });
  }

  return new MemoryPreviewGatewayStore();
}

export class MemoryPreviewGatewayStore implements PreviewGatewayStore {
  private sessions = new Map<string, PreviewGatewaySession>();
  private names = new Map<string, string>();
  private queues = new Map<string, PreviewGatewayRequest[]>();
  private responses = new Map<string, PreviewGatewayResponse>();

  async createSession(session: PreviewGatewaySession): Promise<void> {
    this.sessions.set(session.id, session);
    this.names.set(session.name, session.id);
    this.queues.set(session.id, []);
  }

  async getSessionByName(name: string): Promise<PreviewGatewaySession | undefined> {
    const id = this.names.get(name);
    return id ? this.getSessionById(id) : undefined;
  }

  async getSessionById(id: string): Promise<PreviewGatewaySession | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      await this.deleteSession(session);
      return undefined;
    }
    return session;
  }

  async touchSession(session: PreviewGatewaySession, _ttlMs: number): Promise<void> {
    // A concurrent delete (the preview was stopped) must win: a poll handler
    // that outlives the DELETE must never resurrect a session that is no
    // longer stored, or its name would look "online" and block a restart.
    if (!this.sessions.has(session.id)) return;
    this.sessions.set(session.id, session);
    const nameOwner = this.names.get(session.name);
    if (!nameOwner || nameOwner === session.id) {
      this.names.set(session.name, session.id);
    }
  }

  async enqueueRequest(sessionId: string, request: PreviewGatewayRequest): Promise<void> {
    const queue = this.queues.get(sessionId) || [];
    queue.push(request);
    this.queues.set(sessionId, queue);
  }

  async takeRequests(sessionId: string, limit: number): Promise<PreviewGatewayRequest[]> {
    const queue = this.queues.get(sessionId) || [];
    return queue.splice(0, limit);
  }

  async saveResponse(
    sessionId: string,
    requestId: string,
    response: PreviewGatewayResponse,
  ): Promise<void> {
    this.responses.set(responseKey(sessionId, requestId), response);
  }

  async getResponse(
    sessionId: string,
    requestId: string,
  ): Promise<PreviewGatewayResponse | undefined> {
    return this.responses.get(responseKey(sessionId, requestId));
  }

  async deleteResponse(sessionId: string, requestId: string): Promise<void> {
    this.responses.delete(responseKey(sessionId, requestId));
  }

  async deleteSession(session: PreviewGatewaySession): Promise<void> {
    this.sessions.delete(session.id);
    // The name may have been taken over by a newer session; only remove the
    // mapping if it still points at the session being deleted.
    if (this.names.get(session.name) === session.id) {
      this.names.delete(session.name);
    }
    this.queues.delete(session.id);
  }
}

export class RedisRestPreviewGatewayStore implements PreviewGatewayStore {
  constructor(private options: { url: string; token: string; prefix?: string }) {}

  async createSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    await this.command("SET", this.sessionKey(session.id), JSON.stringify(session), "PX", ttlMs);
    await this.command("SET", this.nameKey(session.name), session.id, "PX", ttlMs);
    await this.command("DEL", this.queueKey(session.id));
  }

  async getSessionByName(name: string): Promise<PreviewGatewaySession | undefined> {
    const id = await this.command<string | null>("GET", this.nameKey(name));
    return id ? this.getSessionById(id) : undefined;
  }

  async getSessionById(id: string): Promise<PreviewGatewaySession | undefined> {
    const value = await this.command<string | null>("GET", this.sessionKey(id));
    return value ? JSON.parse(value) : undefined;
  }

  async touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    const nextSession = { ...session };
    const remainingTtlMs = Math.max(1, Math.min(ttlMs, session.expiresAt - Date.now()));
    // XX only refreshes a session key that still exists. A poll handler that
    // outlives a DELETE must not recreate the session (nor its name mapping),
    // which would otherwise block reclaiming the name on restart.
    const result = await this.command<string | null>(
      "SET",
      this.sessionKey(session.id),
      JSON.stringify(nextSession),
      "PX",
      remainingTtlMs,
      "XX",
    );
    if (result === null) return;
    const nameOwner = await this.command<string | null>("GET", this.nameKey(session.name));
    if (!nameOwner || nameOwner === session.id) {
      await this.command("SET", this.nameKey(session.name), session.id, "PX", remainingTtlMs);
    }
    await this.command("EXPIRE", this.queueKey(session.id), Math.ceil(remainingTtlMs / 1000));
  }

  async enqueueRequest(
    sessionId: string,
    request: PreviewGatewayRequest,
    ttlMs: number,
  ): Promise<void> {
    await this.command("RPUSH", this.queueKey(sessionId), JSON.stringify(request));
    await this.command("EXPIRE", this.queueKey(sessionId), Math.ceil(ttlMs / 1000));
  }

  async takeRequests(sessionId: string, limit: number): Promise<PreviewGatewayRequest[]> {
    const values = await this.command<string[] | string | null>(
      "LPOP",
      this.queueKey(sessionId),
      limit,
    );
    if (!values) return [];
    const list = Array.isArray(values) ? values : [values];
    return list.map((value) => JSON.parse(value));
  }

  async saveResponse(
    sessionId: string,
    requestId: string,
    response: PreviewGatewayResponse,
    ttlMs: number,
  ): Promise<void> {
    await this.command(
      "SET",
      this.responseKey(sessionId, requestId),
      JSON.stringify(response),
      "PX",
      ttlMs,
    );
  }

  async getResponse(
    sessionId: string,
    requestId: string,
  ): Promise<PreviewGatewayResponse | undefined> {
    const value = await this.command<string | null>("GET", this.responseKey(sessionId, requestId));
    return value ? JSON.parse(value) : undefined;
  }

  async deleteResponse(sessionId: string, requestId: string): Promise<void> {
    await this.command("DEL", this.responseKey(sessionId, requestId));
  }

  async deleteSession(session: PreviewGatewaySession): Promise<void> {
    const keys = [this.sessionKey(session.id), this.queueKey(session.id)];
    // The name may have been taken over by a newer session; only remove the
    // mapping if it still points at the session being deleted.
    const nameOwner = await this.command<string | null>("GET", this.nameKey(session.name));
    if (nameOwner === session.id) {
      keys.push(this.nameKey(session.name));
    }
    await this.command("DEL", ...keys);
  }

  private async command<T = unknown>(...args: Array<string | number>) {
    const response = await fetch(this.options.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(args),
    });

    if (!response.ok) {
      throw new Error(
        `Preview gateway Redis command failed (${response.status}): ${await response.text()}`,
      );
    }

    const data = (await response.json()) as { result?: T; error?: string };
    if (data.error) {
      throw new Error(`Preview gateway Redis command failed: ${data.error}`);
    }
    return data.result as T;
  }

  private key(value: string) {
    return `${this.options.prefix || "farm-preview"}:${value}`;
  }

  private sessionKey(id: string) {
    return this.key(`session:${id}`);
  }

  private nameKey(name: string) {
    return this.key(`name:${name}`);
  }

  private queueKey(id: string) {
    return this.key(`queue:${id}`);
  }

  private responseKey(sessionId: string, requestId: string) {
    return this.key(`response:${sessionId}:${requestId}`);
  }
}

async function createSession(
  request: Request,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
) {
  const input = (await request.json().catch(() => ({}))) as {
    name?: string;
    localUrl?: string;
    expiresInMs?: number;
  };
  const requestedName = sanitizePreviewName(input.name);
  let name = requestedName || randomPreviewName();
  let expiresAt = Date.now() + config.sessionTtlMs;
  let slidingExpiration = true;
  let ownerId: string | undefined;
  let project: string | undefined;
  let keyId: string | undefined;
  let grantId: string | undefined;

  if (config.auth) {
    const grantToken = readPreviewBearerToken(request);
    if (!grantToken) {
      throw new GatewayHttpError(401, "Sign in with Farm Preview before creating a session.");
    }
    try {
      const grant = verifyPreviewTunnelGrant(grantToken, {
        signingSecret: config.auth.signingSecret,
        ...(requestedName ? { name: requestedName } : {}),
      });
      name = grant.name;
      ownerId = `${grant.provider || "github"}:${grant.subject}`;
      project = grant.project ?? grant.name;
      keyId = grant.keyId;
      grantId = grant.nonce;
      expiresAt = grant.expiresAt;
      slidingExpiration = false;
    } catch (error) {
      if (error instanceof PreviewAuthError)
        throw new GatewayHttpError(error.status, error.message);
      throw error;
    }
  } else if (Number.isFinite(input.expiresInMs)) {
    expiresAt = Date.now() + clamp(Number(input.expiresInMs), 60_000, config.sessionTtlMs);
    slidingExpiration = false;
  }

  // A name that is still owned by a live session cannot be claimed by a new
  // one — otherwise any caller could repoint an active preview's public URL
  // to their own session. Stale sessions (missed heartbeats) may be taken
  // over, matching how public routing treats them.
  for (let attempt = 0; ; attempt++) {
    const existing = await store.getSessionByName(name);
    if (!existing || !isPreviewClientOnline(existing, config)) {
      break;
    }
    if (requestedName || config.auth) {
      return text(
        `A Farm preview named "${name}" is already active. Choose another name or stop the running preview.`,
        409,
      );
    }
    if (attempt >= 4) {
      return text("Could not allocate a unique preview name. Try again.", 503);
    }
    name = randomPreviewName();
  }

  const hostname = `${name}.${config.domain}`;
  const session: PreviewGatewaySession = {
    ...(grantId ? { grantId } : {}),
    ...(project ? { project } : {}),
    ...(keyId ? { keyId } : {}),
    ...(ownerId ? { ownerId } : {}),
    id: randomId("sess"),
    name,
    hostname,
    publicUrl: createPublicUrl(request, config, name),
    token: randomId("token"),
    localUrl: input.localUrl,
    createdAt: Date.now(),
    expiresAt,
    ...(slidingExpiration ? { slidingExpiration: true as const } : {}),
    lastHeartbeatAt: Date.now(),
  };

  await requireSessionAccess(config, session);
  await store.createSession(session, Math.max(1, expiresAt - Date.now()));
  reportSession(config, session, "connected");

  return json({
    id: session.id,
    name: session.name,
    token: session.token,
    publicUrl: session.publicUrl,
    ...(session.slidingExpiration ? {} : { expiresAt: session.expiresAt }),
  });
}

async function handleSessionRoute(
  request: Request,
  url: URL,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  route: { sessionId: string; action?: string; requestId?: string },
) {
  const session = await requireSession(
    store,
    route.sessionId,
    readPreviewBearerToken(request) || url.searchParams.get("token"),
  );

  // Cleanup is still possible when the authority is unavailable or the grant is revoked.
  if (request.method !== "DELETE" || route.action) await requireSessionAccess(config, session);

  if (request.method === "GET" && route.action === "requests") {
    return await pollSessionRequests(url, store, config, session);
  }

  if (request.method === "POST" && route.action === "responses" && route.requestId) {
    let response: PreviewGatewayResponse;
    try {
      response = await parsePreviewResponse(request, config.maxResponseBodyBytes);
    } catch (error) {
      if (error instanceof GatewayHttpError && error.status === 413) {
        await store.saveResponse(
          session.id,
          route.requestId,
          createOversizedPreviewResponse(config.maxResponseBodyBytes),
          remainingSessionTtl(session, config),
        );
      }
      throw error;
    }
    await store.saveResponse(
      session.id,
      route.requestId,
      response,
      remainingSessionTtl(session, config),
    );
    await markSessionOnline(store, config, session);
    return json({ ok: true });
  }

  if (request.method === "POST" && route.action === "heartbeat") {
    await markSessionOnline(store, config, session);
    return json({
      ok: true,
      ...(session.slidingExpiration ? {} : { expiresAt: session.expiresAt }),
    });
  }

  if (request.method === "DELETE" && !route.action) {
    await store.deleteSession(session);
    reportSession(config, session, "disconnected");
    return json({ ok: true });
  }

  return text("Preview gateway route not found.", 404);
}

async function parsePreviewResponse(request: Request, maxBodyBytes: number) {
  const maxEncodedBytes = Math.ceil(maxBodyBytes / 3) * 4 + 64 * 1024;
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxEncodedBytes) {
    await request.body?.cancel();
    throw new GatewayHttpError(413, "Preview response body is too large.");
  }

  const bytes = await readBodyWithLimit(
    request,
    maxEncodedBytes,
    "Preview response body is too large.",
  );
  let response: PreviewGatewayResponse;
  try {
    response = JSON.parse(bytes.toString("utf8")) as PreviewGatewayResponse;
  } catch {
    throw new GatewayHttpError(400, "Preview response body must be valid JSON.");
  }

  if (getPreviewResponseBodySize(response) > maxBodyBytes) {
    throw new GatewayHttpError(413, "Preview response body is too large.");
  }
  return response;
}

function getPreviewResponseBodySize(response: PreviewGatewayResponse) {
  if (!response.body) return 0;
  return Buffer.byteLength(response.body, response.encoding === "base64" ? "base64" : "utf8");
}

function createOversizedPreviewResponse(maxBodyBytes: number): PreviewGatewayResponse {
  return {
    status: 502,
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: Buffer.from(
      `The local preview response exceeded the ${maxBodyBytes} byte limit.`,
    ).toString("base64"),
    encoding: "base64",
  };
}

async function pollSessionRequests(
  url: URL,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  const waitMs = clamp(Number(url.searchParams.get("wait") || config.pollTimeoutMs), 1000, 25000);
  const deadline = Date.now() + waitMs;
  let nextAccessCheckAt = Date.now() + 1000;

  await markSessionOnline(store, config, session);

  while (Date.now() < deadline) {
    if (Date.now() >= nextAccessCheckAt) {
      await requireSessionAccess(config, session);
      nextAccessCheckAt = Date.now() + 1000;
    }
    const requests = await store.takeRequests(session.id, DEFAULT_POLL_REQUEST_LIMIT);
    if (requests.length) {
      await requireSessionAccess(config, session);
      await markSessionOnline(store, config, session);
      return json({ requests });
    }
    await delay(config.pollIntervalMs);
  }

  await markSessionOnline(store, config, session);
  return new Response(null, { status: 204 });
}

async function proxyPublicRequest(
  request: Request,
  url: URL,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  route: { name: string; path: string },
) {
  const session = await store.getSessionByName(route.name);
  if (!session) {
    return inactivePreviewResponse(request, route.name);
  }
  if (!isPreviewClientOnline(session, config)) {
    await store.deleteSession(session);
    reportSession(config, session, "disconnected");
    return inactivePreviewResponse(request, route.name);
  }

  await requireSessionAccess(config, session);

  const startedAt = Date.now();
  let status = 500;
  try {
    const previewRequest = await serializePreviewRequest(
      request,
      url,
      route.path,
      config.maxBodyBytes,
    );
    await store.enqueueRequest(session.id, previewRequest, remainingSessionTtl(session, config));
    await store.touchSession(session, remainingSessionTtl(session, config));

    const response = await waitForPreviewResponse(
      store,
      config,
      session,
      previewRequest.id,
      request.signal,
    );
    if (response === "cancelled") {
      status = 499;
      await store.enqueueRequest(
        session.id,
        {
          ...previewRequest,
          body: undefined,
          encoding: undefined,
          cancelled: true,
          createdAt: Date.now(),
        },
        remainingSessionTtl(session, config),
      );
      return new Response(null, { status: 499 });
    }
    if (response === "stale") {
      status = 503;
      return inactivePreviewResponse(request, route.name);
    }
    if (!response) {
      status = 504;
      return text("The local Farm preview did not respond before the gateway timed out.", 504);
    }

    const headers = new Headers();
    const responseHopByHopHeaders = getHopByHopHeaderNames(response.headers || {});
    for (const [key, value] of Object.entries(response.headers || {})) {
      const normalized = key.toLowerCase();
      if (responseHopByHopHeaders.has(normalized) || normalized === "content-encoding") {
        continue;
      }
      // Append multi-valued headers (Set-Cookie) so every value reaches the
      // visitor; Headers.set would keep only the last.
      for (const single of Array.isArray(value) ? value : [value]) {
        headers.append(key, single);
      }
    }
    headers.set("cache-control", "no-store");
    headers.set("x-farm-preview", session.name);

    status = response.status || 200;
    return new Response(
      response.body
        ? Buffer.from(response.body, response.encoding === "base64" ? "base64" : "utf8")
        : null,
      {
        status,
        headers,
      },
    );
  } catch (error) {
    if (error instanceof GatewayHttpError) status = error.status;
    throw error;
  } finally {
    if (config.observer?.request)
      observe(() =>
        config.observer!.request!({
          sessionId: session.id,
          method: request.method,
          path: route.path.split(/[?#]/, 1)[0].slice(0, 2048),
          status,
          durationMs: Date.now() - startedAt,
          at: Date.now(),
        }),
      );
  }
}

async function waitForPreviewResponse(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
  requestId: string,
  signal: AbortSignal,
) {
  const deadline = Date.now() + config.requestTimeoutMs;
  let nextLivenessCheckAt = 0;

  while (Date.now() < deadline) {
    if (signal.aborted) return "cancelled";
    if (Date.now() >= nextLivenessCheckAt) {
      await requireSessionAccess(config, session);
      const latestSession = await store.getSessionById(session.id);
      if (!latestSession || !isPreviewClientOnline(latestSession, config)) {
        if (latestSession) await store.deleteSession(latestSession);
        return "stale";
      }
      nextLivenessCheckAt = Date.now() + 1000;
    }

    const response = await store.getResponse(session.id, requestId);
    if (response) {
      await requireSessionAccess(config, session);
      await store.deleteResponse(session.id, requestId);
      return response;
    }
    try {
      await delay(config.pollIntervalMs, undefined, { signal });
    } catch {
      if (signal.aborted) return "cancelled";
      throw new Error("Preview response polling was interrupted.");
    }
  }

  return undefined;
}

async function requireSessionAccess(
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  if (!config.authorizeSession) return;
  const { id, name, ownerId, project, keyId, grantId, expiresAt } = session;
  let allowed;
  try {
    allowed = await config.authorizeSession({
      id,
      name,
      ownerId,
      project,
      keyId,
      grantId,
      expiresAt,
    });
  } catch {
    throw new GatewayHttpError(503, "Preview access verification is temporarily unavailable.");
  }
  if (allowed !== true) throw new GatewayHttpError(403, "This preview is no longer authorized.");
}

async function markSessionOnline(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  const now = Date.now();
  session.lastHeartbeatAt = now;
  if (session.slidingExpiration) {
    session.expiresAt = now + config.sessionTtlMs;
  }
  await store.touchSession(session, remainingSessionTtl(session, config));
  reportSession(config, session, "connected");
}

function remainingSessionTtl(session: PreviewGatewaySession, config: PreviewGatewayRuntimeConfig) {
  return Math.max(1, Math.min(config.sessionTtlMs, session.expiresAt - Date.now()));
}

function isPreviewClientOnline(
  session: PreviewGatewaySession,
  config: PreviewGatewayRuntimeConfig,
) {
  const lastHeartbeatAt = session.lastHeartbeatAt || session.createdAt;
  return (
    session.expiresAt > Date.now() &&
    Date.now() - lastHeartbeatAt <= config.clientHeartbeatTimeoutMs
  );
}

async function serializePreviewRequest(
  request: Request,
  url: URL,
  routePath: string,
  maxBodyBytes: number,
): Promise<PreviewGatewayRequest> {
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  const requestHopByHopHeaders = getHopByHopHeaderNames(request.headers);
  request.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (
      !requestHopByHopHeaders.has(normalized) &&
      normalized !== "forwarded" &&
      !normalized.startsWith("x-forwarded-")
    ) {
      headers[key] = value;
    }
  });

  headers["x-forwarded-host"] = request.headers.get("host") || url.host;
  headers["x-forwarded-proto"] = url.protocol.replace(":", "");

  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > maxBodyBytes) {
      throw new GatewayHttpError(413, "Preview request body is too large.");
    }

    const buffer = await readBodyWithLimit(
      request,
      maxBodyBytes,
      "Preview request body is too large.",
    );
    body = buffer.toString("base64");
  }

  return {
    id: randomId("req"),
    method,
    path: `${routePath}${url.search}`,
    headers,
    body,
    encoding: body ? "base64" : undefined,
    createdAt: Date.now(),
  };
}

async function readBodyWithLimit(request: Request, maxBytes: number, message: string) {
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new GatewayHttpError(413, message);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, size);
}

async function requireSession(store: PreviewGatewayStore, sessionId: string, token: string | null) {
  const session = await store.getSessionById(sessionId);
  if (!session || !token || token !== session.token) {
    throw new GatewayHttpError(401, "Invalid preview gateway session.");
  }
  return session;
}

function resolvePublicPreviewRoute(request: Request, url: URL, domain: string) {
  const pathMatch = url.pathname.match(/^\/__preview\/([^/]+)(\/.*)?$/);
  if (pathMatch) {
    return {
      name: pathMatch[1],
      path: pathMatch[2] || "/",
    };
  }

  const host = (request.headers.get("host") || url.host).split(":")[0];
  if (!host || host === domain || !host.endsWith(`.${domain}`)) {
    return undefined;
  }

  return {
    name: host.slice(0, -(domain.length + 1)),
    path: url.pathname || "/",
  };
}

function matchSessionRoute(pathname: string) {
  const match = pathname.match(
    /^\/api\/sessions\/([^/]+)(?:\/(requests|heartbeat|responses)(?:\/([^/]+))?)?$/,
  );
  if (!match) return undefined;
  return {
    sessionId: match[1],
    action: match[2],
    requestId: match[3],
  };
}

function nodeRequestToWebRequest(req: IncomingMessage, signal?: AbortSignal) {
  const host = headerValue(req.headers, "host") || "localhost";
  // This adapter is the public trust boundary. A visitor-controlled forwarded
  // protocol must not influence the authority serialized to the local app.
  const protocol = isLocalHost(host.split(":")[0]) ? "http" : "https";
  const url = `${protocol}://${host}${req.url || "/"}`;
  const headers = nodeHeadersToWebHeaders(req.headers);
  const method = req.method || "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
    signal,
  };

  if (method !== "GET" && method !== "HEAD") {
    init.body = req as unknown as BodyInit;
    init.duplex = "half";
  }

  return new Request(url, init);
}

function nodeHeadersToWebHeaders(headers: IncomingHttpHeaders) {
  const next = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) next.append(key, item);
    } else {
      next.set(key, value);
    }
  }
  return next;
}

function headerValue(headers: IncomingHttpHeaders, key: string) {
  const value = headers[key];
  return Array.isArray(value) ? value[0] : value;
}

function createPublicUrl(request: Request, config: PreviewGatewayRuntimeConfig, name: string) {
  // Each browser preview needs its own origin: a path prefix cannot relocate
  // root-relative scripts, imports, fetches, or client-side navigation.
  if (config.domain === "localhost" || config.domain.endsWith(".localhost")) {
    const base = new URL(config.baseUrl || request.url);
    base.hostname = `${name}.${config.domain}`;
    return base.origin;
  }
  if (config.baseUrl) {
    const base = new URL(config.baseUrl);
    if (isLocalHost(base.hostname)) {
      return `${config.baseUrl.replace(/\/+$/, "")}/__preview/${name}`;
    }
  }

  const host = request.headers.get("host") || new URL(request.url).host;
  if (isLocalHost(host.split(":")[0])) {
    return `${new URL(request.url).origin}/__preview/${name}`;
  }

  return `https://${name}.${config.domain}`;
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}

function text(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function inactivePreviewResponse(request: Request, name: string) {
  if (!request.headers.get("accept")?.includes("text/html")) {
    return text(`No active Farm preview is running for "${name}".`, 404);
  }
  const safeName = name.replace(/[&<>"']/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    if (character === '"') return "&quot;";
    return "&#39;";
  });
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farm preview expired</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;background:#f7f7f5;color:#171714}main{max-width:34rem;padding:2rem;text-align:center}h1{font-size:1.75rem}code{background:#e9e9e4;border-radius:.35rem;padding:.15rem .35rem}</style><main><h1>This Farm preview has expired</h1><p>The temporary preview <code>${safeName}</code> is no longer connected.</p><p>Ask its owner to run <code>farm preview</code> again.</p></main></html>`,
    {
      status: 410,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

function sanitizePreviewName(value: string | undefined) {
  if (!value) return undefined;
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomPreviewName() {
  return `farm-${Math.random().toString(36).slice(2, 8)}`;
}

function randomId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function normalizeDomain(value: string) {
  return value
    .replace(/^https?:\/\//, "")
    .replace(/^\.*/, "")
    .replace(/\/*$/, "");
}

function responseKey(sessionId: string, requestId: string) {
  return `${sessionId}:${requestId}`;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isLocalHost(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

class GatewayHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
