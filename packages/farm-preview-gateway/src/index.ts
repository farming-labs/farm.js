import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
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
  /**
   * Whether another preview transport (the persistent relay) serves this name
   * live, or keeps it reserved for an owner other than `ownerId`. The relay
   * route wins over this gateway for the same hostname, so a name it claims
   * gets no polling session or tunnel grant here. Errors fail closed.
   */
  isPreviewNameClaimed?: (name: string, ownerId?: string) => boolean | Promise<boolean>;
  /**
   * How long a name stays bound to its owner after that owner disconnects or
   * stops heartbeating. Another owner cannot claim it in that window, so a
   * reconnect wins over another account. Defaults to 5 minutes.
   */
  nameReservationMs?: number;
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
  /**
   * Stores a session and claims its name atomically. The claim succeeds when
   * the name is free, already belongs to this session, or still belongs to
   * `options.replaceSessionId` (a stale session the gateway decided to take
   * over). Return `false` when another session holds the name; nothing may
   * be stored in that case. Stores that resolve `undefined` are treated as
   * having claimed the name.
   */
  createSession(
    session: PreviewGatewaySession,
    ttlMs: number,
    options?: PreviewGatewayCreateSessionOptions,
  ): Promise<boolean | void>;
  getSessionByName(name: string): Promise<PreviewGatewaySession | undefined>;
  getSessionById(id: string): Promise<PreviewGatewaySession | undefined>;
  touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void>;
  enqueueRequest(sessionId: string, request: PreviewGatewayRequest, ttlMs: number): Promise<void>;
  takeRequests(sessionId: string, limit: number): Promise<PreviewGatewayRequest[]>;
  /**
   * Puts requests taken by a poll that could not deliver them back at the
   * head of the queue, in their original order. Stores without it fall back
   * to `enqueueRequest`, which keeps the requests but not their position.
   */
  requeueRequests?(
    sessionId: string,
    requests: PreviewGatewayRequest[],
    ttlMs: number,
  ): Promise<void>;
  saveResponse(
    sessionId: string,
    requestId: string,
    response: PreviewGatewayResponse,
    ttlMs: number,
  ): Promise<void>;
  getResponse(sessionId: string, requestId: string): Promise<PreviewGatewayResponse | undefined>;
  deleteResponse(sessionId: string, requestId: string): Promise<void>;
  deleteSession(session: PreviewGatewaySession): Promise<void>;
  /**
   * Binds a name to the owner that last held it for `ttlMs` after its session
   * is deleted. Optional; without it the binding ends with the session record.
   */
  reserveName?(name: string, ownerId: string, ttlMs: number): Promise<void>;
  /** The owner a deleted session's name is still bound to, if any. */
  getNameReservation?(name: string): Promise<string | undefined>;
}

export interface PreviewGatewayCreateSessionOptions {
  /** A stale session whose name the new session may take over. */
  replaceSessionId?: string;
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
  isPreviewNameClaimed?: PreviewGatewayOptions["isPreviewNameClaimed"];
  nameReservationMs: number;
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
const DEFAULT_NAME_RESERVATION_MS = 1000 * 60 * 5;
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
    isPreviewNameClaimed: options.isPreviewNameClaimed,
    nameReservationMs: options.nameReservationMs ?? DEFAULT_NAME_RESERVATION_MS,
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
        return await createTunnelGrant(request, config.auth, store, config);
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
      // Unexpected errors can carry store or provider details (for example a
      // Redis REST error body), so visitors only see a fixed message.
      console.error("[farm-preview-gateway] Unexpected error:", error);
      return text("Unexpected preview gateway error.", 500);
    }
  };

  // The persistent relay serves the same public hostnames from a separate name
  // namespace, and its route wins over this handler, so it has to be able to
  // ask whether a live polling session already owns a name (or keeps it
  // reserved for another owner) before accepting a claim for it.
  return Object.assign(handlePreviewGatewayRequest, {
    async isPreviewNameClaimed(name: string, ownerId?: string) {
      const claimed = sanitizePreviewName(name);
      if (!claimed) return false;
      const session = await store.getSessionByName(claimed);
      // A live session blocks the other transport unless both are the same
      // verified owner (a CLI switching transports), which is harmless.
      if (
        session &&
        isPreviewClientOnline(session, config) &&
        (!ownerId || session.ownerId !== ownerId)
      ) {
        return true;
      }
      return await isNameHeldByAnotherOwner(store, config, claimed, ownerId, session);
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

async function createTunnelGrant(
  request: Request,
  auth: PreviewManagedAuthOptions,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
) {
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
  // A grant for a name another account holds could only ever be used to take
  // that hostname over, so it is refused up front. Claims check again.
  const ownerId = `${account.provider}:${account.subject}`;
  if (
    (await isNameHeldByAnotherOwner(
      store,
      config,
      name,
      ownerId,
      await store.getSessionByName(name),
    )) ||
    (await askOtherTransport(config, name, ownerId))
  ) {
    return text(previewNameUnavailableMessage(name), 409);
  }

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
  private reservations = new Map<string, { ownerId: string; expiresAt: number }>();

  async createSession(
    session: PreviewGatewaySession,
    _ttlMs: number,
    options: PreviewGatewayCreateSessionOptions = {},
  ): Promise<boolean> {
    // No await between the ownership check and the write, so concurrent
    // claims for one name cannot both succeed.
    const owner = this.names.get(session.name);
    if (
      owner &&
      owner !== session.id &&
      owner !== options.replaceSessionId &&
      this.sessions.has(owner)
    ) {
      return false;
    }
    this.sessions.set(session.id, session);
    this.names.set(session.name, session.id);
    this.queues.set(session.id, []);
    return true;
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

  async requeueRequests(sessionId: string, requests: PreviewGatewayRequest[]): Promise<void> {
    if (!this.sessions.has(sessionId)) return;
    const queue = this.queues.get(sessionId) || [];
    queue.unshift(...requests);
    this.queues.set(sessionId, queue);
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

  async reserveName(name: string, ownerId: string, ttlMs: number): Promise<void> {
    const now = Date.now();
    for (const [reserved, reservation] of this.reservations) {
      if (reservation.expiresAt <= now) this.reservations.delete(reserved);
    }
    this.reservations.set(name, { ownerId, expiresAt: now + ttlMs });
  }

  async getNameReservation(name: string): Promise<string | undefined> {
    const reservation = this.reservations.get(name);
    if (!reservation) return undefined;
    if (reservation.expiresAt <= Date.now()) {
      this.reservations.delete(name);
      return undefined;
    }
    return reservation.ownerId;
  }
}

// Claims KEYS[1] for ARGV[2] when the name is free, already ours, or still
// held by the replaceable owner ARGV[1] (empty when there is none).
const CLAIM_NAME_SCRIPT = `
  local owner = redis.call("GET", KEYS[1])
  if not owner or owner == ARGV[2] or (ARGV[1] ~= "" and owner == ARGV[1]) then
    redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
    return 1
  end
  return 0
`;

export class RedisRestPreviewGatewayStore implements PreviewGatewayStore {
  constructor(private options: { url: string; token: string; prefix?: string }) {}

  async createSession(
    session: PreviewGatewaySession,
    ttlMs: number,
    options: PreviewGatewayCreateSessionOptions = {},
  ): Promise<boolean> {
    // The session record is written before the name is claimed, so a name
    // that points at a missing session always belongs to a dead one.
    await this.command("SET", this.sessionKey(session.id), JSON.stringify(session), "PX", ttlMs);
    let claimed = await this.claimName(session, options.replaceSessionId, ttlMs);
    if (!claimed) {
      const owner = await this.command<string | null>("GET", this.nameKey(session.name));
      if (owner && !(await this.command<number>("EXISTS", this.sessionKey(owner)))) {
        claimed = await this.claimName(session, owner, ttlMs);
      }
    }
    if (!claimed) {
      await this.command("DEL", this.sessionKey(session.id));
      return false;
    }
    await this.command("DEL", this.queueKey(session.id));
    return true;
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
    await this.claimName(session, undefined, remainingTtlMs);
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

  async requeueRequests(
    sessionId: string,
    requests: PreviewGatewayRequest[],
    ttlMs: number,
  ): Promise<void> {
    if (!requests.length) return;
    // LPUSH prepends one value at a time, so push in reverse to keep order.
    const values = requests.map((request) => JSON.stringify(request)).reverse();
    await this.command("LPUSH", this.queueKey(sessionId), ...values);
    await this.command("EXPIRE", this.queueKey(sessionId), Math.ceil(ttlMs / 1000));
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

  async reserveName(name: string, ownerId: string, ttlMs: number): Promise<void> {
    await this.command(
      "SET",
      this.reservationKey(name),
      ownerId,
      "PX",
      Math.max(1, Math.ceil(ttlMs)),
    );
  }

  async getNameReservation(name: string): Promise<string | undefined> {
    return (await this.command<string | null>("GET", this.reservationKey(name))) ?? undefined;
  }

  private async claimName(
    session: PreviewGatewaySession,
    replaceSessionId: string | undefined,
    ttlMs: number,
  ) {
    const result = await this.command<number>(
      "EVAL",
      CLAIM_NAME_SCRIPT,
      1,
      this.nameKey(session.name),
      replaceSessionId || "",
      session.id,
      Math.max(1, Math.ceil(ttlMs)),
    );
    return Number(result) === 1;
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

  private reservationKey(name: string) {
    return this.key(`reserved:${name}`);
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
  // one, otherwise any caller could repoint an active preview's public URL
  // to their own session. Stale sessions (missed heartbeats) may be taken
  // over, matching how public routing treats them. The store claims the name
  // atomically, so two concurrent creates cannot both win the same name.
  let session: PreviewGatewaySession;
  for (let attempt = 0; ; attempt++) {
    const existing = await store.getSessionByName(name);
    if (
      (!existing || !isPreviewClientOnline(existing, config)) &&
      !(await isNameHeldByAnotherOwner(store, config, name, ownerId, existing))
    ) {
      session = {
        ...(grantId ? { grantId } : {}),
        ...(project ? { project } : {}),
        ...(keyId ? { keyId } : {}),
        ...(ownerId ? { ownerId } : {}),
        id: randomId("sess"),
        name,
        hostname: `${name}.${config.domain}`,
        publicUrl: createPublicUrl(request, config, name),
        token: randomId("token"),
        localUrl: input.localUrl,
        createdAt: Date.now(),
        expiresAt,
        ...(slidingExpiration ? { slidingExpiration: true as const } : {}),
        lastHeartbeatAt: Date.now(),
      };
      await requireSessionAccess(config, session);
      const claimed = await store.createSession(
        session,
        Math.max(1, expiresAt - Date.now()),
        existing ? { replaceSessionId: existing.id } : undefined,
      );
      if (claimed !== false) {
        // The relay route wins over this gateway for the same hostname. The
        // claim is stored before asking, and the relay does the same, so two
        // concurrent claims on different transports cannot both win.
        let claimedElsewhere: boolean;
        try {
          claimedElsewhere = await askOtherTransport(config, name, ownerId);
        } catch (error) {
          await store.deleteSession(session);
          throw error;
        }
        if (!claimedElsewhere) break;
        await store.deleteSession(session);
      }
    }
    if (requestedName || config.auth) {
      return text(previewNameUnavailableMessage(name), 409);
    }
    if (attempt >= 4) {
      return text("Could not allocate a unique preview name. Try again.", 503);
    }
    name = randomPreviewName();
  }

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
    return await pollSessionRequests(url, store, config, session, request.signal);
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
    await releasePreviewSession(store, config, session);
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
  signal: AbortSignal,
) {
  const waitMs = clamp(Number(url.searchParams.get("wait") || config.pollTimeoutMs), 1000, 25000);
  const deadline = Date.now() + waitMs;
  let nextAccessCheckAt = Date.now() + 1000;
  // A poll whose client went away must neither take requests nor keep the
  // session looking online: nobody receives its response.
  const abandoned = () => new Response(null, { status: 499 });

  if (signal.aborted) return abandoned();
  await markSessionOnline(store, config, session);

  while (Date.now() < deadline) {
    if (signal.aborted) return abandoned();
    if (Date.now() >= nextAccessCheckAt) {
      await requireSessionAccess(config, session);
      nextAccessCheckAt = Date.now() + 1000;
    }
    const requests = await store.takeRequests(session.id, DEFAULT_POLL_REQUEST_LIMIT);
    if (requests.length) {
      try {
        await requireSessionAccess(config, session);
        if (!signal.aborted) await markSessionOnline(store, config, session);
      } catch (error) {
        await requeuePreviewRequests(store, config, session, requests);
        throw error;
      }
      if (signal.aborted) {
        await requeuePreviewRequests(store, config, session, requests);
        return abandoned();
      }
      return json({ requests });
    }
    try {
      await delay(config.pollIntervalMs, undefined, { signal });
    } catch {
      if (signal.aborted) return abandoned();
      throw new Error("Preview request polling was interrupted.");
    }
  }

  if (signal.aborted) return abandoned();
  await markSessionOnline(store, config, session);
  return new Response(null, { status: 204 });
}

async function requeuePreviewRequests(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
  requests: PreviewGatewayRequest[],
) {
  const ttlMs = remainingSessionTtl(session, config);
  if (store.requeueRequests) {
    await store.requeueRequests(session.id, requests, ttlMs);
    return;
  }
  for (const request of requests) {
    await store.enqueueRequest(session.id, request, ttlMs);
  }
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
    await releasePreviewSession(store, config, session);
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
        headers.append(key, normalized === "set-cookie" ? withoutCookieDomain(single) : single);
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
        if (latestSession) await releasePreviewSession(store, config, latestSession);
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

function previewNameUnavailableMessage(name: string) {
  return `A Farm preview named "${name}" is already active. Choose another name or stop the running preview.`;
}

/**
 * A name stays bound to its owner while a session holds it and for
 * nameReservationMs after that owner stops heartbeating or disconnects, so a
 * different account cannot take a hostname whose visitors (and their cookies)
 * still belong to someone else. The same owner can always reclaim it.
 */
async function isNameHeldByAnotherOwner(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  name: string,
  ownerId: string | undefined,
  session: PreviewGatewaySession | undefined,
) {
  if (session?.ownerId && session.ownerId !== ownerId) {
    const lastHeartbeatAt = session.lastHeartbeatAt || session.createdAt;
    if (Date.now() - lastHeartbeatAt <= config.clientHeartbeatTimeoutMs + config.nameReservationMs)
      return true;
  }
  if (!store.getNameReservation) return false;
  const reservedFor = await store.getNameReservation(name);
  return reservedFor !== undefined && reservedFor !== ownerId;
}

async function askOtherTransport(
  config: PreviewGatewayRuntimeConfig,
  name: string,
  ownerId: string | undefined,
) {
  if (!config.isPreviewNameClaimed) return false;
  try {
    return (await config.isPreviewNameClaimed(name, ownerId)) === true;
  } catch {
    throw new GatewayHttpError(503, "Preview name verification is temporarily unavailable.");
  }
}

/** Deletes a session, keeping its name bound to its owner for the reservation window. */
async function releasePreviewSession(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  if (session.ownerId && store.reserveName && config.nameReservationMs > 0) {
    // A newer session that already took the name over keeps its own binding.
    const current = await store.getSessionByName(session.name);
    if (!current || current.id === session.id) {
      await store.reserveName(session.name, session.ownerId, config.nameReservationMs);
    }
  }
  await store.deleteSession(session);
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
  if (!session || !token || !tokensMatch(token, session.token)) {
    throw new GatewayHttpError(401, "Invalid preview gateway session.");
  }
  return session;
}

function tokensMatch(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Every preview is a sibling host under the gateway's domain. A tenant cookie
 * with `Domain=<domain>` would be sent to every other preview, letting one
 * preview set or shadow cookies for another, so a proxied cookie stays
 * host-only.
 */
function withoutCookieDomain(setCookie: string): string {
  const [pair, ...attributes] = setCookie.split(";");
  return [pair, ...attributes.filter((part) => !/^\s*domain\s*(=|$)/i.test(part))].join(";");
}

function resolvePublicPreviewRoute(request: Request, url: URL, domain: string) {
  const host = (request.headers.get("host") || url.host)
    .split(":")[0]
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");

  // Every preview subdomain is its own origin. Honoring the path form there
  // would let `alice.<domain>/__preview/bob` serve bob's app, cookies, and
  // scripts on alice's origin, so tenant hosts route only by subdomain.
  if (host.endsWith(`.${domain}`)) {
    return {
      name: host.slice(0, -(domain.length + 1)),
      path: url.pathname || "/",
    };
  }

  const pathMatch = url.pathname.match(/^\/__preview\/([^/]+)(\/.*)?$/);
  if (!pathMatch) return undefined;
  return {
    name: pathMatch[1],
    path: pathMatch[2] || "/",
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
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farm preview expired</title><style>body{font:16px/1.5 system-ui,sans-serif;display:grid;min-height:100vh;margin:0;place-items:center;background:#f7f7f5;color:#171714}main{max-width:34rem;padding:2rem;text-align:center}h1{font-size:1.75rem}code{background:#e9e9e4;border-radius:.35rem;padding:.15rem .35rem}footer{margin-top:2.5rem;padding-top:1.5rem;border-top:1px solid #e3e3de;color:#6b6b63;font-size:.875rem}footer p{margin:0 0 1rem}footer p a{color:#171714;text-underline-offset:.2em}.start{display:inline-block;border-radius:.5rem;padding:.5rem .9rem;background:#171714;color:#f7f7f5;font-weight:500;text-decoration:none}</style><main><h1>This Farm preview has expired</h1><p>The temporary preview <code>${safeName}</code> is no longer connected.</p><p>Ask its owner to run <code>farm preview</code> again.</p><footer><p>Previews like this come from <a href="https://farmjs.dev">Farm.js</a>. One command shares your local app.</p><a class="start" href="https://farmjs.dev/docs/preview">Try farm preview</a></footer></main></html>`,
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
    .trim()
    .toLowerCase()
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
