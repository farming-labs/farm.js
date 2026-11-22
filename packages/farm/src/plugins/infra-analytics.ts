/**
 * Built-in Farm Infra analytics.
 *
 * On whenever the server environment sets `FARMJS_API_KEY`. A key scoped to one project
 * names it; a key reaching several projects also needs `FARMJS_PROJECT_ID`.
 * `analytics: false` in farm.config turns it off. It never sends without a key.
 *
 * Only server-side metadata leaves the app: the route template (see route-label.ts), the path
 * that was requested below the base path, method, status, duration, registered MCP tool
 * outcomes and the client the request declares (see classifyFarmClient: a category and a name
 * from Farm's own list, never the header itself). No query strings, fragments, origins,
 * headers, cookies, request bodies, IPs or errors.
 *
 * A registered MCP tool call also sends its arguments and result, unless
 * `FARMJS_TOOL_PAYLOADS=off`: values under secret-looking keys are replaced first (see
 * toolPayload), and one larger than Farm Infra keeps is left out.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FarmPlugin, FarmPluginRuntimeAfterEvent } from "../plugin";
import {
  _classifyFarmMCPSession,
  _farmMCPClientSession,
  _isFarmMCPRequest,
  classifyFarmAgent,
  classifyFarmClient,
  type FarmAgentIdentity,
  type FarmClientIdentity,
} from "../agent-identity";
import { _farmToolCallPayload, onFarmEvent } from "../observability";
import { getCurrentRequestOrNull } from "../server/request";
import { getFarmRouteLabel } from "../route-label";
import { stripFarmBasePath } from "../base-path";

export type FarmInfraAnalyticsEnvironment = "production" | "staging" | "development";

export interface FarmInfraAnalyticsDiagnostic {
  code: "dropped" | "retry" | "disabled";
  count?: number;
  status?: number;
  /**
   * Why Farm Infra refused the key, for `disabled`: it reaches several projects and no
   * project was named, it lacks analytics:write, or it only sends another environment.
   */
  reason?: "project" | "permission" | "environment";
}

export interface FarmInfraAnalyticsExporterOptions {
  endpoint: string;
  /** A Farm Infra API key (`farmjs_…`), or a project's write-only ingestion key (`fti_…`). */
  key: string;
  /** Needed only for an API key reaching several projects; one project's key names it. */
  projectId?: string;
  environment?: FarmInfraAnalyticsEnvironment;
  /** Send each MCP tool call's arguments and result. On unless `false`. */
  toolPayloads?: boolean;
  onDiagnostic?: (event: FarmInfraAnalyticsDiagnostic) => void | Promise<void>;
}

/** @deprecated Use `FarmAgentIdentity` from `@farm.js/core`. */
export type FarmInfraAgentIdentity = FarmAgentIdentity;

interface EventBase {
  id: string;
  timestamp: string;
  durationMs: number;
  route: string;
  /** `/products/42` for the route `/products/[id]`; absent when Farm Infra would refuse it. */
  path?: string;
  requestId: string;
  agent: FarmClientIdentity;
}

export type FarmInfraAnalyticsEvent = EventBase &
  (
    | { kind: "request"; method: string; status: number }
    | {
        kind: "mcp.tool";
        tool: string;
        outcome: "success" | "error";
        /** The call's arguments and result, with secret-looking keys redacted. */
        arguments?: unknown;
        result?: unknown;
        /** The payloads left out because they were larger than Farm Infra keeps. */
        omitted?: ("arguments" | "result")[];
      }
  );

type Env = Record<string, string | undefined>;

/** Set while `farm build` prerenders pages, whose requests aren't real traffic. */
export const FARM_PRERENDER_ENV = "FARM_PRERENDER";

const DEFAULT_URL = "https://app.farmjs.dev";
const EVENTS_PATH = "/api/telemetry/v1/events";
const INGESTION_KEY = /^fti_[A-Za-z0-9_-]{43}$/;
const API_KEY = /^farmjs_[A-Za-z0-9_-]{32}$/;
const PROJECT = /^proj_[0-9a-f-]{36}$/;
const ENVIRONMENTS: FarmInfraAnalyticsEnvironment[] = ["production", "staging", "development"];
const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"]);

const MAX_QUEUE = 500;
/** Farm Infra's limits for one request body, and for one tool call argument or result. */
const MAX_BODY_BYTES = 128 * 1024;
const MAX_PAYLOAD_BYTES = 8 * 1024;
const MAX_PAYLOAD_DEPTH = 32;
/** Keys whose values a tool call payload never sends: `password`, `apiKey`, `x-session-token`. */
const SECRET_KEY =
  /pass(?:word|wd|phrase)|secret|token|api[-_]?key|authori[sz]ation|cookie|credential|private[-_]?key|session/i;
const REDACTED = "[redacted]";
const MAX_AGE = 300_000;
const MAX_ATTEMPTS = 5;
const FLUSH_BUDGET = 5_000;
const TIMEOUT = 2_000;
const encoder = new TextEncoder();
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const uuid = () => globalThis.crypto.randomUUID();

function processEnv(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

/** Where the app is running: FARMJS_ENVIRONMENT, then Vercel (preview is staging), then NODE_ENV. */
export function defaultFarmInfraEnvironment(
  env: Env = processEnv(),
): FarmInfraAnalyticsEnvironment {
  const explicit = env.FARMJS_ENVIRONMENT as FarmInfraAnalyticsEnvironment | undefined;
  if (explicit && ENVIRONMENTS.includes(explicit)) return explicit;
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "staging";
  if (env.VERCEL_ENV === "development") return "development";
  return env.NODE_ENV === "production" ? "production" : "development";
}

/**
 * The sender options the environment links the app to, `null` when it isn't linked,
 * or a reason it can't be used. A misconfiguration never stops the app.
 */
export function resolveFarmInfraAnalytics(
  env: Env = processEnv(),
): { options: FarmInfraAnalyticsExporterOptions } | { off: string | null } {
  const key = env.FARMJS_API_KEY?.trim();
  if (!key || env[FARM_PRERENDER_ENV] === "1") return { off: null };
  const ingestionKey = INGESTION_KEY.test(key);
  // Optional: Farm Infra resolves the project of a key scoped to exactly one.
  const projectId = env.FARMJS_PROJECT_ID?.trim() || undefined;
  if (!ingestionKey && !API_KEY.test(key)) {
    return {
      off: "FARMJS_API_KEY isn't a Farm Infra API key (farmjs_…) or write-only key (fti_…)",
    };
  }
  if (!ingestionKey && projectId && !PROJECT.test(projectId)) {
    return { off: "FARMJS_PROJECT_ID isn't a Farm Infra project ID (proj_…)" };
  }
  if (env.FARMJS_ENVIRONMENT && !ENVIRONMENTS.includes(env.FARMJS_ENVIRONMENT as never)) {
    return { off: "FARMJS_ENVIRONMENT must be production, staging or development" };
  }
  const toolPayloads = env.FARMJS_TOOL_PAYLOADS?.trim();
  if (toolPayloads && toolPayloads !== "on" && toolPayloads !== "off") {
    return { off: "FARMJS_TOOL_PAYLOADS must be on or off" };
  }
  let endpoint: URL;
  try {
    endpoint = new URL(EVENTS_PATH, env.FARMJS_API_URL?.trim() || DEFAULT_URL);
  } catch {
    return { off: "FARMJS_API_URL isn't a URL" };
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (endpoint.protocol !== "https:" && !(endpoint.protocol === "http:" && loopback)) ||
    endpoint.username ||
    endpoint.password
  ) {
    return { off: "FARMJS_API_URL must use HTTPS (HTTP only for localhost)" };
  }
  return {
    options: {
      endpoint: endpoint.href,
      key,
      ...(toolPayloads === "off" ? { toolPayloads: false } : {}),
      ...(ingestionKey
        ? {}
        : { ...(projectId ? { projectId } : {}), environment: defaultFarmInfraEnvironment(env) }),
    },
  };
}

// A self-reported declaration, not proof of identity. Keep raw headers out of the event.
export function classifyFarmInfraAgent(userAgent: string | null): FarmInfraAgentIdentity {
  return classifyFarmAgent(userAgent);
}

function routeTemplate(pattern: unknown): string {
  return typeof pattern === "string" &&
    pattern.length <= 256 &&
    /^\/(?!\/)[a-zA-Z0-9_./:[\]()*-]*$/.test(pattern)
    ? pattern
    : "/[unmatched]";
}

// Farm Infra's rule for a path. One that fails it would reject the whole batch, so the event
// goes without it instead. A URL parser's pathname only fails it with a leading `//` or
// characters outside printable ASCII the parser left alone.
const PATH = /^\/(?!\/)[\w!$%&'()*+,\-./:;=@[\]^|~]*$/;
const MAX_PATH_LENGTH = 1024;

function requestPath(request: Request): string | undefined {
  const path = stripFarmBasePath(new URL(request.url).pathname);
  return path.length <= MAX_PATH_LENGTH && PATH.test(path) ? path : undefined;
}

function duration(value: number): number {
  return Number.isFinite(value) ? Math.min(86_400_000, Math.max(0, value)) : 0;
}

function isToolEvent(value: unknown): value is {
  type: "mcp.tool.complete";
  tool: string;
  outcome: "success" | "error";
  durationMs: number;
} {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return (
    event.type === "mcp.tool.complete" &&
    typeof event.tool === "string" &&
    /^[a-zA-Z0-9_.:/-]{1,128}$/.test(event.tool) &&
    (event.outcome === "success" || event.outcome === "error") &&
    typeof event.durationMs === "number" &&
    Number.isFinite(event.durationMs)
  );
}

function retryAt(value: string | null, now: number): number {
  if (!value) return now;
  if (/^\d+$/.test(value.trim())) return now + Math.min(Number(value), 86_400) * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, Math.min(date, now + 86_400_000)) : now;
}

const REFUSALS: Record<string, FarmInfraAnalyticsDiagnostic["reason"]> = {
  project: "project",
  api_key_permission: "permission",
  api_key_environment: "environment",
};

/** The known error code of a 400 or 403 from Farm Infra, reading at most 1 KiB within 500 ms. */
async function refusal(response: Response): Promise<FarmInfraAnalyticsDiagnostic["reason"]> {
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  let text = "";
  const decoder = new TextDecoder();
  const deadline = Date.now() + 500;
  try {
    while (text.length < 1024 && Date.now() < deadline) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value?: undefined }>((resolve) => {
          timer = setTimeout(() => resolve({ done: true }), deadline - Date.now());
        }),
      ]).finally(() => clearTimeout(timer));
      if (chunk.done) break;
      text += decoder.decode(chunk.value, { stream: true });
    }
    const code = (JSON.parse(text) as { error?: unknown }).error;
    return typeof code === "string" && Object.prototype.hasOwnProperty.call(REFUSALS, code)
      ? REFUSALS[code]
      : undefined;
  } catch {
    return undefined;
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** Bounded best-effort delivery. Never retains a Request, Response, or payload body. */
export function createFarmInfraAnalyticsExporter(
  options: FarmInfraAnalyticsExporterOptions,
  send: typeof fetch = (input, init) => fetch(input, init),
) {
  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${options.key}`,
  };
  // An API key names the environment it writes to, and the project when it reaches several.
  // A write-only key names both itself.
  if (!INGESTION_KEY.test(options.key)) {
    if (options.projectId) requestHeaders["x-farm-project"] = options.projectId;
    requestHeaders["x-farm-environment"] = options.environment ?? defaultFarmInfraEnvironment();
  }
  type Item = { event: FarmInfraAnalyticsEvent; enqueuedAt: number; attempts: number };
  const queue: Item[] = [];
  let stopped = false;
  let closing = false;
  let pending: Promise<void> | undefined;
  let notBefore = 0;
  let active: AbortController | undefined;
  let inFlight = new Set<Item>();
  const diagnostic = (event: FarmInfraAnalyticsDiagnostic) => {
    try {
      void Promise.resolve(options.onDiagnostic?.(event)).catch(() => {});
    } catch {
      /* Optional observer. */
    }
  };
  const expired = (item: Item, now: number) =>
    !inFlight.has(item) && (now - item.enqueuedAt >= MAX_AGE || item.attempts >= MAX_ATTEMPTS);
  function prune() {
    const now = Date.now();
    let count = 0;
    for (let i = queue.length - 1; i >= 0; i--) {
      if (expired(queue[i]!, now)) {
        queue.splice(i, 1);
        count++;
      }
    }
    if (count) diagnostic({ code: "dropped", count });
  }
  function remove(batch: Item[]) {
    const sent = new Set(batch);
    for (let i = queue.length - 1; i >= 0; i--) if (sent.has(queue[i]!)) queue.splice(i, 1);
  }
  function enqueue(event: FarmInfraAnalyticsEvent) {
    if (stopped || closing) return;
    prune();
    if (queue.length >= MAX_QUEUE) {
      diagnostic({ code: "dropped", count: 1 });
      return;
    }
    queue.push({ event, enqueuedAt: Date.now(), attempts: 0 });
  }
  async function drain() {
    const deadline = Date.now() + FLUSH_BUDGET;
    // Coalesce simultaneous completions while keeping the entire drain in waitUntil.
    await sleep(25);
    while (!stopped && queue.length && Date.now() < deadline) {
      prune();
      if (!queue.length || notBefore >= deadline) break;
      if (notBefore > Date.now()) await sleep(notBefore - Date.now());
      if (stopped || Date.now() >= deadline) break;
      // Tool call payloads make events uneven, so a batch takes as many as fit in one body.
      const batch: Item[] = [];
      let bytes = 64;
      for (const item of queue) {
        const size = encoder.encode(JSON.stringify(item.event)).length + 1;
        if (batch.length === 50 || (batch.length && bytes + size > MAX_BODY_BYTES)) break;
        batch.push(item);
        bytes += size;
      }
      const body = JSON.stringify({ schemaVersion: 1, events: batch.map(({ event }) => event) });
      if (encoder.encode(body).length > MAX_BODY_BYTES) {
        queue.splice(0, batch.length);
        diagnostic({ code: "dropped", count: batch.length });
        continue;
      }
      for (const item of batch) item.attempts++;
      inFlight = new Set(batch);
      active = new AbortController();
      const timeout = setTimeout(() => active?.abort(), Math.min(TIMEOUT, deadline - Date.now()));
      let status: number | undefined;
      try {
        const response = await send(options.endpoint, {
          method: "POST",
          redirect: "error",
          signal: active.signal,
          headers: requestHeaders,
          body,
        });
        status = response.status;
        // Only a refusal's error code is read, from a bounded prefix, and never logged as text.
        const reason = status === 400 || status === 403 ? await refusal(response) : undefined;
        // The receipt body is not needed; never wait for or log arbitrary response text.
        void response.body?.cancel().catch(() => {});
        if (response.ok) {
          remove(batch);
          continue;
        }
        // Bad credentials, a project the key can't reach, or a contract mismatch.
        if ([400, 401, 403, 404, 413, 415].includes(status) || (status >= 300 && status < 400)) {
          stopped = true;
          queue.length = 0;
          diagnostic({ code: "disabled", status, ...(reason ? { reason } : {}) });
          break;
        }
        if (status !== 408 && status !== 429 && status < 500) {
          remove(batch);
          diagnostic({ code: "dropped", count: batch.length, status });
          continue;
        }
        notBefore = Math.max(notBefore, retryAt(response.headers.get("retry-after"), Date.now()));
      } catch {
        /* Network failure or deadline: keep the same event IDs for a bounded retry. */
      } finally {
        clearTimeout(timeout);
        active = undefined;
        inFlight.clear();
      }
      notBefore = Math.max(
        notBefore,
        Date.now() + Math.min(30_000, 500 * 2 ** (batch[0]!.attempts - 1)),
      );
      diagnostic({ code: "retry", ...(status === undefined ? {} : { status }) });
    }
  }
  function flush(): Promise<void> {
    if (stopped || !queue.length || notBefore > Date.now() + FLUSH_BUDGET)
      return pending ?? Promise.resolve();
    pending ??= drain()
      .catch(() => {})
      .finally(() => {
        pending = undefined;
      });
    return pending;
  }
  async function close(): Promise<void> {
    if (closing) {
      await pending;
      return;
    }
    closing = true;
    await flush();
    stopped = true;
    active?.abort();
    if (queue.length) diagnostic({ code: "dropped", count: queue.length });
    queue.length = 0;
  }
  return { enqueue, flush, close };
}

interface State {
  exporter: ReturnType<typeof createFarmInfraAnalyticsExporter>;
  unsubscribe?: () => void;
}

interface RequestMetadata {
  id: string;
  agent: FarmClientIdentity;
  /** For an MCP client's `initialize`: the session ID naming it, once the body is read. */
  mcpSession: Promise<string | undefined> | undefined;
  /** Read from the request as it arrived, before a handler can rewrite it. */
  path: string | undefined;
  /** Read when an event is made: a handler may label the route while it answers. */
  route: object | undefined;
  completed: boolean;
  waitUntil(promise: Promise<unknown>): void;
}

const CONTEXT_KEY = "farm.infra.analytics";

function beginRequest(
  request: Request,
  route: object | undefined,
  waitUntil: (promise: Promise<unknown>) => void,
): RequestMetadata {
  return {
    id: uuid(),
    agent: classifyFarmClient(request),
    mcpSession: readMCPClientSession(request),
    path: requestPath(request),
    route,
    completed: false,
    waitUntil,
  };
}

/** An `initialize` is a few hundred bytes; a larger body isn't read. */
const MAX_MCP_BODY = 64 * 1024;

/**
 * An MCP client names itself only in `initialize`, and Farm's MCP servers are stateless, so a
 * later tool call can't say which client made it. Reads the client's name from a clone of an
 * `initialize` POST while the server answers; see withMCPClientSession and rfcs/0009.
 */
function readMCPClientSession(request: Request): Promise<string | undefined> | undefined {
  if (
    request.headers.has("mcp-session-id") ||
    !_isFarmMCPRequest(request) ||
    !request.body ||
    request.bodyUsed ||
    !/json/i.test(request.headers.get("content-type") ?? "") ||
    Number(request.headers.get("content-length")) > MAX_MCP_BODY
  )
    return undefined;
  let body: ReadableStream<Uint8Array>;
  try {
    body = request.clone().body!;
  } catch {
    return undefined;
  }
  return readMCPInitialize(body).catch(() => undefined);
}

async function readMCPInitialize(body: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_MCP_BODY) return undefined;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const parsed: unknown = JSON.parse(text + decoder.decode());
  const initialize = (Array.isArray(parsed) ? parsed : [parsed]).find(
    (message) => message?.method === "initialize",
  ) as { params?: { clientInfo?: { name?: unknown } } } | undefined;
  return _farmMCPClientSession(initialize?.params?.clientInfo?.name);
}

/**
 * The `initialize` response with the session ID naming its client, which MCP clients send with
 * every later request. A server with sessions of its own keeps its ID. `undefined` leaves the
 * response as it is.
 */
async function withMCPClientSession(
  response: Response,
  metadata: RequestMetadata,
): Promise<Response | undefined> {
  const session = await metadata.mcpSession;
  if (!session || !response.ok || response.headers.has("mcp-session-id")) return undefined;
  // The initialize request names its client too, as the calls after it will.
  metadata.agent = _classifyFarmMCPSession(session) ?? metadata.agent;
  const headers = new Headers(response.headers);
  headers.set("Mcp-Session-Id", session);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function requestEvent(
  metadata: RequestMetadata,
  method: string,
  status: number,
  durationMs: number,
): FarmInfraAnalyticsEvent {
  return {
    id: uuid(),
    requestId: metadata.id,
    timestamp: new Date().toISOString(),
    route: routeTemplate(getFarmRouteLabel(metadata.route)),
    ...(metadata.path ? { path: metadata.path } : {}),
    agent: metadata.agent,
    kind: "request",
    method,
    status,
    durationMs: duration(durationMs),
  };
}

/**
 * A tool call argument or result as Farm Infra keeps it: JSON, with each value under a
 * secret-looking key replaced by `[redacted]`. `"omitted"` when it's larger or deeper than
 * Farm Infra keeps, and `undefined` when there's nothing to send or it isn't JSON.
 */
function toolPayload(value: unknown): { value: unknown } | "omitted" | undefined {
  let json: unknown;
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return undefined;
    json = JSON.parse(text);
  } catch {
    return undefined;
  }
  let deep = false;
  const redact = (node: unknown, depth: number): unknown => {
    if (depth > MAX_PAYLOAD_DEPTH) deep = true;
    if (deep || !node || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => redact(item, depth + 1));
    return Object.fromEntries(
      Object.entries(node).map(([key, item]) => [
        key,
        SECRET_KEY.test(key) ? REDACTED : redact(item, depth + 1),
      ]),
    );
  };
  const redacted = redact(json, 0);
  if (deep || encoder.encode(JSON.stringify(redacted)).length > MAX_PAYLOAD_BYTES) {
    return "omitted";
  }
  return { value: redacted };
}

function toolPayloadFields(event: unknown) {
  const payload = _farmToolCallPayload(event);
  if (!payload) return {};
  const fields: { arguments?: unknown; result?: unknown; omitted?: ("arguments" | "result")[] } =
    {};
  for (const key of ["arguments", "result"] as const) {
    if (!(key in payload)) continue;
    const kept = toolPayload(payload[key]);
    if (kept === "omitted") (fields.omitted ??= []).push(key);
    else if (kept) fields[key] = kept.value;
  }
  return fields;
}

function toolEvent(
  metadata: RequestMetadata,
  event: { tool: string; outcome: "success" | "error"; durationMs: number },
  payloads: boolean,
): FarmInfraAnalyticsEvent {
  return {
    id: uuid(),
    requestId: metadata.id,
    timestamp: new Date().toISOString(),
    route: routeTemplate(getFarmRouteLabel(metadata.route)),
    ...(metadata.path ? { path: metadata.path } : {}),
    agent: metadata.agent,
    kind: "mcp.tool",
    tool: event.tool,
    outcome: event.outcome,
    durationMs: duration(event.durationMs),
    ...(payloads ? toolPayloadFields(event) : {}),
  };
}

/** The runtime plugin for already-resolved options, for servers with a plugin runtime. */
export function farmInfraAnalyticsPlugin(
  options: FarmInfraAnalyticsExporterOptions,
  send?: typeof fetch,
): FarmPlugin<State> {
  // Scoped per instance, so two app instances in one process never share request metadata.
  const contextKey = `${CONTEXT_KEY}.${uuid()}`;
  return {
    name: "farm:infra-analytics",
    enforce: "post",
    setup(context) {
      const state: State = { exporter: createFarmInfraAnalyticsExporter(options, send) };
      context.lifecycle.onShutdown(async () => {
        state.unsubscribe?.();
        await state.exporter.close();
      });
      return state;
    },
    runtime: {
      // Recording a request decides nothing about who may read the response.
      cache: "public",
      start(context) {
        const { exporter } = context.state;
        context.state.unsubscribe = onFarmEvent(
          (event: unknown) => {
            if (!isToolEvent(event)) return;
            const request = getCurrentRequestOrNull();
            if (!request) return;
            const metadata = context.requestContext.get<RequestMetadata>(request, contextKey);
            // Streaming MCP transports can return their HTTP Response before the tool finishes.
            if (!metadata) return;
            exporter.enqueue(toolEvent(metadata, event, options.toolPayloads !== false));
            metadata.waitUntil(exporter.flush());
          },
          { unfiltered: true },
        );
      },
      before(event) {
        if (event.kind === "asset" || !event.state) return;
        event.req.set(contextKey, beginRequest(event.request, event.route, event.waitUntil));
      },
      after(event: FarmPluginRuntimeAfterEvent<State>) {
        // A plugin endpoint answers before any runtime.before hook runs.
        const metadata =
          event.req.get<RequestMetadata>(contextKey) ??
          (event.kind === "endpoint"
            ? beginRequest(event.request, event.route, event.waitUntil)
            : undefined);
        if (!metadata || metadata.completed || !event.state) return;
        metadata.completed = true;
        const { exporter } = event.state;
        const record = () => {
          if (!METHODS.has(event.request.method)) return;
          exporter.enqueue(
            requestEvent(metadata, event.request.method, event.response.status, event.durationMs),
          );
          event.waitUntil(exporter.flush());
        };
        if (!metadata.mcpSession) return record();
        return withMCPClientSession(event.response, metadata).then((response) => {
          record();
          return response;
        });
      },
      // Unhandled exceptions have no final HTTP status at this boundary. Do not fabricate a 500.
      error(event) {
        const metadata = event.req.get<RequestMetadata>(contextKey);
        if (metadata) metadata.completed = true;
        if (event.state) event.waitUntil(event.state.exporter.flush());
      },
    },
  };
}

export interface FarmInfraAnalyticsRecorder {
  /** Runs one request, reporting its route template, path, method, status and duration. */
  record(
    request: Request,
    options: { kind?: string; route?: { pattern?: string } },
    waitUntil: ((promise: Promise<unknown>) => void) | undefined,
    handler: () => Promise<Response>,
  ): Promise<Response>;
  close(): Promise<void>;
}

/**
 * The same reporting without a plugin runtime, so a production server whose plugins only add
 * routes (`@farm.js/mcp` without OAuth among them) doesn't import one. Tool calls happen inside
 * the request, which an API route may have rewritten by then, so each request's metadata
 * travels in an async scope of its own rather than keyed by its Request.
 */
export function farmInfraAnalyticsRecorder(
  options: FarmInfraAnalyticsExporterOptions,
  send?: typeof fetch,
): FarmInfraAnalyticsRecorder {
  const exporter = createFarmInfraAnalyticsExporter(options, send);
  const requests = new AsyncLocalStorage<RequestMetadata>();
  const unsubscribe = onFarmEvent(
    (event: unknown) => {
      if (!isToolEvent(event)) return;
      const metadata = requests.getStore();
      if (!metadata) return;
      exporter.enqueue(toolEvent(metadata, event, options.toolPayloads !== false));
      metadata.waitUntil(exporter.flush());
    },
    { unfiltered: true },
  );
  return {
    async record(request, runtime, waitUntil, handler) {
      if (runtime.kind === "asset") return handler();
      const background = (promise: Promise<unknown>) =>
        waitUntil ? waitUntil(promise) : void promise.catch(() => {});
      const metadata = beginRequest(request, runtime.route, background);
      const startedAt = performance.now();
      let response: Response;
      try {
        response = await requests.run(metadata, handler);
      } catch (error) {
        background(exporter.flush());
        throw error;
      }
      const durationMs = performance.now() - startedAt;
      const named = metadata.mcpSession && (await withMCPClientSession(response, metadata));
      if (METHODS.has(request.method)) {
        exporter.enqueue(requestEvent(metadata, request.method, response.status, durationMs));
      }
      background(exporter.flush());
      return named || response;
    },
    close() {
      unsubscribe();
      return exporter.close();
    },
  };
}

/** Options for the environment's Farm Infra link, warning once about a misconfiguration. */
function linkedOptions(
  env: Env,
  warn: (message: string) => void,
): FarmInfraAnalyticsExporterOptions | null {
  const resolved = resolveFarmInfraAnalytics(env);
  if ("off" in resolved) {
    if (resolved.off) warn(`[Farm] Farm Infra analytics is off: ${resolved.off}.`);
    return null;
  }
  return {
    ...resolved.options,
    onDiagnostic(event) {
      if (event.code !== "disabled") return;
      // A key for another environment, such as a production key in development, is expected.
      if (event.reason === "environment") return;
      warn(`[Farm] Farm Infra analytics stopped: ${stopReason(event)}`);
    },
  };
}

const KEYS_PAGE = "the API keys page (https://app.farmjs.dev/dashboard/settings)";

function stopReason(event: FarmInfraAnalyticsDiagnostic): string {
  if (event.reason === "project") {
    return (
      "FARMJS_API_KEY reaches more than one project. Set FARMJS_PROJECT_ID " +
      "or use a key scoped to one project, then restart the server."
    );
  }
  if (event.reason === "permission") {
    return (
      "this key can't send analytics. Create a Site analytics key on " +
      `${KEYS_PAGE}, set it as FARMJS_API_KEY, then restart the server.`
    );
  }
  if (event.status === 401) {
    return (
      "Farm Infra answered 401: FARMJS_API_KEY was revoked or has expired. Create a new " +
      `Site analytics key on ${KEYS_PAGE}, then restart the server.`
    );
  }
  return (
    `Farm Infra answered ${event.status}. ` +
    "Check FARMJS_API_KEY and FARMJS_PROJECT_ID, then restart the server."
  );
}

/**
 * Farm's built-in analytics plugin when the environment links the app to Farm Infra,
 * otherwise `null`. Read when the server starts, so the build needs no Infra variables.
 */
export function createFarmInfraAnalyticsPlugin(
  env: Env = processEnv(),
  warn: (message: string) => void = console.warn,
): FarmPlugin<State> | null {
  const options = linkedOptions(env, warn);
  return options ? farmInfraAnalyticsPlugin(options) : null;
}

/** {@link createFarmInfraAnalyticsPlugin} for a production server without a plugin runtime. */
export function createFarmInfraAnalyticsRecorder(
  env: Env = processEnv(),
  warn: (message: string) => void = console.warn,
): FarmInfraAnalyticsRecorder | null {
  const options = linkedOptions(env, warn);
  return options ? farmInfraAnalyticsRecorder(options) : null;
}
