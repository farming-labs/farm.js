import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export interface PreviewGatewayOptions {
  domain?: string;
  baseUrl?: string;
  store?: PreviewGatewayStore;
  sessionTtlMs?: number;
  clientHeartbeatTimeoutMs?: number;
  requestTimeoutMs?: number;
  pollTimeoutMs?: number;
  pollIntervalMs?: number;
  maxBodyBytes?: number;
}

export interface PreviewGatewaySession {
  id: string;
  name: string;
  hostname: string;
  publicUrl: string;
  token: string;
  localUrl?: string;
  createdAt: number;
  expiresAt: number;
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
  domain: string;
  baseUrl?: string;
  sessionTtlMs: number;
  clientHeartbeatTimeoutMs: number;
  requestTimeoutMs: number;
  pollTimeoutMs: number;
  pollIntervalMs: number;
  maxBodyBytes: number;
}

const DEFAULT_DOMAIN = "preview.farming-labs.dev";
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 30;
const DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS = 1000 * 20;
const DEFAULT_REQUEST_TIMEOUT_MS = 25000;
const DEFAULT_POLL_TIMEOUT_MS = 15000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024 * 5;
const DEFAULT_POLL_REQUEST_LIMIT = 50;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function createPreviewGatewayHandler(options: PreviewGatewayOptions = {}) {
  const store = options.store || createPreviewGatewayStoreFromEnv();
  const config = {
    domain: normalizeDomain(options.domain || process.env.FARM_PREVIEW_DOMAIN || DEFAULT_DOMAIN),
    baseUrl: options.baseUrl || process.env.FARM_PREVIEW_GATEWAY_URL,
    sessionTtlMs: options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS,
    clientHeartbeatTimeoutMs:
      options.clientHeartbeatTimeoutMs ?? DEFAULT_CLIENT_HEARTBEAT_TIMEOUT_MS,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    pollTimeoutMs: options.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
    pollIntervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  };

  return async function handlePreviewGatewayRequest(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);

      if (request.method === "GET" && url.pathname === "/api/health") {
        return json({
          ok: true,
          domain: config.domain,
          store: store.constructor.name || "PreviewGatewayStore",
        });
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
      if (error instanceof GatewayHttpError) {
        return text(error.message, error.status);
      }
      return text(
        error instanceof Error ? error.message : "Unexpected preview gateway error.",
        500,
      );
    }
  };
}

export function createNodePreviewGatewayHandler(options: PreviewGatewayOptions = {}) {
  const handler = createPreviewGatewayHandler(options);

  return async function nodePreviewGatewayHandler(req: IncomingMessage, res: ServerResponse) {
    const response = await handler(nodeRequestToWebRequest(req));
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
  };
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

  async touchSession(session: PreviewGatewaySession, ttlMs: number): Promise<void> {
    // A concurrent delete (the preview was stopped) must win: a poll handler
    // that outlives the DELETE must never resurrect a session that is no
    // longer stored, or its name would look "online" and block a restart.
    if (!this.sessions.has(session.id)) return;
    session.expiresAt = Date.now() + ttlMs;
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
    const nextSession = {
      ...session,
      expiresAt: Date.now() + ttlMs,
    };
    // XX only refreshes a session key that still exists. A poll handler that
    // outlives a DELETE must not recreate the session (nor its name mapping),
    // which would otherwise block reclaiming the name on restart.
    const result = await this.command<string | null>(
      "SET",
      this.sessionKey(session.id),
      JSON.stringify(nextSession),
      "PX",
      ttlMs,
      "XX",
    );
    if (result === null) return;
    const nameOwner = await this.command<string | null>("GET", this.nameKey(session.name));
    if (!nameOwner || nameOwner === session.id) {
      await this.command("SET", this.nameKey(session.name), session.id, "PX", ttlMs);
    }
    await this.command("EXPIRE", this.queueKey(session.id), Math.ceil(ttlMs / 1000));
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
  };
  const requestedName = sanitizePreviewName(input.name);
  let name = requestedName || randomPreviewName();

  // A name that is still owned by a live session cannot be claimed by a new
  // one — otherwise any caller could repoint an active preview's public URL
  // to their own session. Stale sessions (missed heartbeats) may be taken
  // over, matching how public routing treats them.
  for (let attempt = 0; ; attempt++) {
    const existing = await store.getSessionByName(name);
    if (!existing || !isPreviewClientOnline(existing, config)) {
      break;
    }
    if (requestedName) {
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
    id: randomId("sess"),
    name,
    hostname,
    publicUrl: createPublicUrl(request, config, name),
    token: randomId("token"),
    localUrl: input.localUrl,
    createdAt: Date.now(),
    expiresAt: Date.now() + config.sessionTtlMs,
    lastHeartbeatAt: Date.now(),
  };

  await store.createSession(session, config.sessionTtlMs);

  return json({
    id: session.id,
    name: session.name,
    token: session.token,
    publicUrl: session.publicUrl,
    expiresAt: session.expiresAt,
  });
}

async function handleSessionRoute(
  request: Request,
  url: URL,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  route: { sessionId: string; action?: string; requestId?: string },
) {
  const session = await requireSession(store, route.sessionId, url.searchParams.get("token"));

  if (request.method === "GET" && route.action === "requests") {
    return await pollSessionRequests(url, store, config, session);
  }

  if (request.method === "POST" && route.action === "responses" && route.requestId) {
    const response = (await request.json()) as PreviewGatewayResponse;
    await store.saveResponse(session.id, route.requestId, response, config.sessionTtlMs);
    await markSessionOnline(store, config, session);
    return json({ ok: true });
  }

  if (request.method === "POST" && route.action === "heartbeat") {
    await markSessionOnline(store, config, session);
    return json({ ok: true, expiresAt: Date.now() + config.sessionTtlMs });
  }

  if (request.method === "DELETE" && !route.action) {
    await store.deleteSession(session);
    return json({ ok: true });
  }

  return text("Preview gateway route not found.", 404);
}

async function pollSessionRequests(
  url: URL,
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  const waitMs = clamp(Number(url.searchParams.get("wait") || config.pollTimeoutMs), 1000, 25000);
  const deadline = Date.now() + waitMs;

  await markSessionOnline(store, config, session);

  while (Date.now() < deadline) {
    const requests = await store.takeRequests(session.id, DEFAULT_POLL_REQUEST_LIMIT);
    if (requests.length) {
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
    return text(`No active Farm preview is running for "${route.name}".`, 404);
  }
  if (!isPreviewClientOnline(session, config)) {
    await store.deleteSession(session);
    return text(`No active Farm preview is running for "${route.name}".`, 404);
  }

  const previewRequest = await serializePreviewRequest(
    request,
    url,
    route.path,
    config.maxBodyBytes,
  );
  await store.enqueueRequest(session.id, previewRequest, config.sessionTtlMs);
  await store.touchSession(session, config.sessionTtlMs);

  const response = await waitForPreviewResponse(store, config, session, previewRequest.id);
  if (response === "stale") {
    return text(`No active Farm preview is running for "${route.name}".`, 404);
  }
  if (!response) {
    return text("The local Farm preview did not respond before the gateway timed out.", 504);
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers || {})) {
    const normalized = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(normalized)) {
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

  return new Response(
    response.body
      ? Buffer.from(response.body, response.encoding === "base64" ? "base64" : "utf8")
      : null,
    {
      status: response.status || 200,
      headers,
    },
  );
}

async function waitForPreviewResponse(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
  requestId: string,
) {
  const deadline = Date.now() + config.requestTimeoutMs;
  let nextLivenessCheckAt = 0;

  while (Date.now() < deadline) {
    if (Date.now() >= nextLivenessCheckAt) {
      const latestSession = await store.getSessionById(session.id);
      if (!latestSession || !isPreviewClientOnline(latestSession, config)) {
        if (latestSession) await store.deleteSession(latestSession);
        return "stale";
      }
      nextLivenessCheckAt = Date.now() + 1000;
    }

    const response = await store.getResponse(session.id, requestId);
    if (response) {
      await store.deleteResponse(session.id, requestId);
      return response;
    }
    await delay(config.pollIntervalMs);
  }

  return undefined;
}

async function markSessionOnline(
  store: PreviewGatewayStore,
  config: PreviewGatewayRuntimeConfig,
  session: PreviewGatewaySession,
) {
  session.lastHeartbeatAt = Date.now();
  await store.touchSession(session, config.sessionTtlMs);
}

function isPreviewClientOnline(
  session: PreviewGatewaySession,
  config: PreviewGatewayRuntimeConfig,
) {
  const lastHeartbeatAt = session.lastHeartbeatAt || session.createdAt;
  return Date.now() - lastHeartbeatAt <= config.clientHeartbeatTimeoutMs;
}

async function serializePreviewRequest(
  request: Request,
  url: URL,
  routePath: string,
  maxBodyBytes: number,
): Promise<PreviewGatewayRequest> {
  const method = request.method.toUpperCase();
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    const normalized = key.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(normalized)) {
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

    const buffer = Buffer.from(await request.arrayBuffer());
    if (buffer.byteLength > maxBodyBytes) {
      throw new GatewayHttpError(413, "Preview request body is too large.");
    }
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

function nodeRequestToWebRequest(req: IncomingMessage) {
  const host = headerValue(req.headers, "host") || "localhost";
  const protocol =
    headerValue(req.headers, "x-forwarded-proto") ||
    (isLocalHost(host.split(":")[0]) ? "http" : "https");
  const url = `${protocol}://${host}${req.url || "/"}`;
  const headers = nodeHeadersToWebHeaders(req.headers);
  const method = req.method || "GET";
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers,
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
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

class GatewayHttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
