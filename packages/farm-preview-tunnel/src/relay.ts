import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import {
  isAgentToRelayMessage,
  normalizePreviewName,
  type ReadyMessage,
  type TunnelRequestMessage,
  type TunnelResponseMessage,
} from "./protocol.js";

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

export interface PersistentPreviewRelayOptions {
  host?: string;
  port?: number;
  publicBaseUrl?: string;
  publicDomain?: string;
  publicWebSocketUrl?: string;
  healthPath?: string;
  fallbackHandler?: PersistentPreviewRelayFallbackHandler;
  coordinator?: PersistentPreviewRelayCoordinator;
  coordinatorSessionTtlMs?: number;
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
}

export type PersistentPreviewRelayFallbackHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;

export interface PersistentPreviewRelayCoordinatorSession {
  id: string;
  name: string;
}

export interface PersistentPreviewRelayCoordinator {
  claimSession(session: PersistentPreviewRelayCoordinatorSession, ttlMs: number): Promise<boolean>;
  findSession(name: string): Promise<PersistentPreviewRelayCoordinatorSession | undefined>;
  touchSession(session: PersistentPreviewRelayCoordinatorSession, ttlMs: number): Promise<boolean>;
  releaseSession(session: PersistentPreviewRelayCoordinatorSession): Promise<void>;
  publishRequest(sessionId: string, request: TunnelRequestMessage): Promise<void>;
  takeRequest(sessionId: string, timeoutMs: number): Promise<TunnelRequestMessage | undefined>;
  publishResponse(sessionId: string, response: TunnelResponseMessage): Promise<void>;
  takeResponse(
    sessionId: string,
    requestId: string,
    timeoutMs: number,
  ): Promise<TunnelResponseMessage | undefined>;
}

export interface PersistentPreviewRelayAddress {
  host: string;
  port: number;
  httpUrl: string;
  websocketUrl: string;
}

interface AgentSession {
  id: string;
  name: string;
  socket: WebSocket;
}

interface PendingRequest {
  response: ServerResponse;
  sessionId: string;
  timeout: NodeJS.Timeout;
}

export function createPersistentPreviewRelay(options: PersistentPreviewRelayOptions = {}) {
  const agents = new Map<string, AgentSession>();
  const pending = new Map<string, PendingRequest>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const host = options.host || "127.0.0.1";
  const publicDomain = normalizeDomain(options.publicDomain);
  const healthPath = options.healthPath || "/api/health";
  const coordinatorSessionTtlMs = options.coordinatorSessionTtlMs ?? 60_000;
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024;
  let address: PersistentPreviewRelayAddress | undefined;

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://localhost");
      if (url.pathname === healthPath) {
        return sendJson(response, 200, {
          ok: true,
          transport: "websocket",
          coordination: options.coordinator ? "shared" : "local",
          agents: agents.size,
        });
      }

      const route = resolvePublicRoute(request, publicDomain);
      if (!route) {
        return handleFallback(request, response, options.fallbackHandler);
      }

      const localSession = agents.get(route.name);
      const activeLocalSession =
        localSession?.socket.readyState === localSession?.socket.OPEN ? localSession : undefined;
      const coordinatedSession = activeLocalSession
        ? undefined
        : await options.coordinator?.findSession(route.name);
      if (!activeLocalSession && !coordinatedSession) {
        return handleFallback(request, response, options.fallbackHandler, () =>
          sendText(response, 404, `No active persistent preview is running for "${route.name}".`),
        );
      }

      await forwardPublicRequest({
        request,
        response,
        path: route.path,
        localSession: activeLocalSession,
        coordinatedSession,
        coordinator: options.coordinator,
        pending,
        requestTimeoutMs,
        maxBodyBytes,
      });
    } catch (error) {
      const status = error instanceof BodyLimitError ? 413 : 500;
      sendText(response, status, error instanceof Error ? error.message : String(error));
    }
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/agent") {
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit("connection", websocket, request);
    });
  });

  websocketServer.on("connection", (socket) => {
    let session: AgentSession | undefined;
    let registering = false;

    socket.on("message", (data) => {
      void (async () => {
        let message: unknown;
        try {
          message = JSON.parse(data.toString());
        } catch {
          rejectSocketMessage(socket, "Invalid tunnel message.");
          return;
        }

        if (!isAgentToRelayMessage(message)) {
          rejectSocketMessage(socket, "Invalid tunnel message.");
          return;
        }

        if (message.type === "register") {
          if (session || registering) {
            rejectSocketMessage(socket, "The preview agent is already registered.");
            return;
          }
          registering = true;
          try {
            const name = normalizePreviewName(message.name);
            if (!name) {
              socket.send(
                JSON.stringify({ type: "error", message: "A valid preview name is required." }),
              );
              socket.close(1008, "Invalid preview name");
              return;
            }

            const existing = agents.get(name);
            if (existing && existing.socket.readyState === existing.socket.OPEN) {
              rejectPreviewName(socket, name);
              return;
            }

            const nextSession = { id: randomUUID(), name, socket };
            if (
              options.coordinator &&
              !(await options.coordinator.claimSession(nextSession, coordinatorSessionTtlMs))
            ) {
              rejectPreviewName(socket, name);
              return;
            }
            if (socket.readyState !== socket.OPEN) {
              await options.coordinator?.releaseSession(nextSession);
              return;
            }

            session = nextSession;
            agents.set(name, session);
            const baseUrl = trimTrailingSlash(options.publicBaseUrl || address?.httpUrl || "");
            if (!baseUrl) {
              socket.close(1011, "Relay is not listening");
              return;
            }
            const ready: ReadyMessage = {
              type: "ready",
              sessionId: session.id,
              publicUrl: createPublicUrl(baseUrl, publicDomain, name),
            };
            socket.send(JSON.stringify(ready));
            if (options.coordinator) {
              void pumpCoordinatedRequests(
                session,
                agents,
                options.coordinator,
                coordinatorSessionTtlMs,
              );
            }
          } finally {
            registering = false;
          }
          return;
        }

        if (message.type === "response") {
          if (!session) {
            rejectSocketMessage(socket, "Register the preview agent before sending responses.");
            return;
          }
          if (!completePendingRequest(message, session.id, pending)) {
            await options.coordinator?.publishResponse(session.id, message);
          }
        }
      })().catch(() => socket.close(1011, "Preview relay coordination failed"));
    });

    socket.on("close", () => {
      if (session && agents.get(session.name)?.id === session.id) {
        agents.delete(session.name);
        failPendingRequestsForSession(session.id, pending);
        void options.coordinator?.releaseSession(session).catch(() => undefined);
      }
    });
  });

  return {
    server,
    async listen(): Promise<PersistentPreviewRelayAddress> {
      if (address) return address;
      await listen(server, options.port ?? 0, host);
      const serverAddress = server.address();
      if (!serverAddress || typeof serverAddress === "string") {
        throw new Error("Persistent preview relay did not expose a TCP address.");
      }
      const displayHost = host === "0.0.0.0" ? "127.0.0.1" : host;
      const localHttpUrl = `http://${displayHost}:${serverAddress.port}`;
      address = {
        host,
        port: serverAddress.port,
        httpUrl: localHttpUrl,
        websocketUrl:
          options.publicWebSocketUrl || `ws://${displayHost}:${serverAddress.port}/agent`,
      };
      return address;
    },
    async close() {
      for (const session of agents.values()) session.socket.close(1001, "Relay shutting down");
      for (const { response, timeout } of pending.values()) {
        clearTimeout(timeout);
        if (!response.headersSent)
          sendText(response, 503, "Persistent preview relay is shutting down.");
      }
      pending.clear();
      await closeWebSocketServer(websocketServer);
      await closeServer(server);
      address = undefined;
    },
  };
}

interface ForwardPublicRequestOptions {
  request: IncomingMessage;
  response: ServerResponse;
  path: string;
  localSession?: AgentSession;
  coordinatedSession?: PersistentPreviewRelayCoordinatorSession;
  coordinator?: PersistentPreviewRelayCoordinator;
  pending: Map<string, PendingRequest>;
  requestTimeoutMs: number;
  maxBodyBytes: number;
}

async function forwardPublicRequest(options: ForwardPublicRequestOptions) {
  const id = randomUUID();
  const uploadController = new AbortController();
  const deadline = Date.now() + options.requestTimeoutMs;
  const timeout = setTimeout(() => {
    uploadController.abort();
    options.pending.delete(id);
    if (!options.response.headersSent) {
      sendText(options.response, 504, "The persistent preview agent did not respond in time.");
    }
  }, options.requestTimeoutMs);

  let body: Buffer;
  try {
    body = await readRequestBody(options.request, options.maxBodyBytes, uploadController.signal);
  } catch (error) {
    if (uploadController.signal.aborted) return;
    clearTimeout(timeout);
    throw error;
  }

  if (uploadController.signal.aborted || options.response.writableEnded) return;
  const message: TunnelRequestMessage = {
    type: "request",
    id,
    method: options.request.method || "GET",
    path: options.path,
    headers: normalizeIncomingHeaders(options.request.headers),
    ...(body.length ? { body: body.toString("base64") } : {}),
  };

  const localSession = options.localSession;
  if (localSession) {
    options.pending.set(id, {
      response: options.response,
      sessionId: localSession.id,
      timeout,
    });
    try {
      localSession.socket.send(JSON.stringify(message), (error) => {
        if (error) failPendingRequest(id, localSession.id, options.pending);
      });
    } catch (error) {
      options.pending.delete(id);
      clearTimeout(timeout);
      throw error;
    }
    return;
  }

  if (!options.coordinator || !options.coordinatedSession) {
    clearTimeout(timeout);
    throw new Error("Persistent preview relay coordination is unavailable.");
  }

  await options.coordinator.publishRequest(options.coordinatedSession.id, message);
  const remainingMs = Math.max(1, deadline - Date.now());
  const coordinatedResponse = await options.coordinator.takeResponse(
    options.coordinatedSession.id,
    id,
    remainingMs,
  );
  clearTimeout(timeout);
  if (options.response.writableEnded) return;
  if (!coordinatedResponse) {
    sendText(options.response, 504, "The persistent preview agent did not respond in time.");
    return;
  }
  writeTunnelResponse(options.response, coordinatedResponse);
}

async function pumpCoordinatedRequests(
  session: AgentSession,
  agents: Map<string, AgentSession>,
  coordinator: PersistentPreviewRelayCoordinator,
  sessionTtlMs: number,
) {
  const waitMs = Math.max(50, Math.min(15_000, Math.floor(sessionTtlMs / 3)));
  try {
    while (
      agents.get(session.name)?.id === session.id &&
      session.socket.readyState === session.socket.OPEN
    ) {
      if (!(await coordinator.touchSession(session, sessionTtlMs))) {
        session.socket.close(1011, "Preview session ownership was lost");
        return;
      }
      const request = await coordinator.takeRequest(session.id, waitMs);
      if (!request) continue;
      if (
        agents.get(session.name)?.id !== session.id ||
        session.socket.readyState !== session.socket.OPEN
      ) {
        return;
      }
      session.socket.send(JSON.stringify(request));
    }
  } catch {
    session.socket.close(1011, "Preview relay coordination failed");
  }
}

function resolvePublicRoute(request: IncomingMessage, publicDomain: string | undefined) {
  const url = new URL(request.url || "/", "http://localhost");
  const match = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
  if (match) {
    const name = normalizePreviewName(match[1]);
    const path = `${match[2] || "/"}${url.search}`;
    return name ? { name, path } : undefined;
  }

  if (!publicDomain) return undefined;
  const host = normalizeHost(request.headers.host);
  const suffix = `.${publicDomain}`;
  if (!host?.endsWith(suffix)) return undefined;

  const subdomain = host.slice(0, -suffix.length);
  const name = normalizePreviewName(subdomain);
  if (!name || name !== subdomain || subdomain.includes(".")) return undefined;
  return { name, path: `${url.pathname || "/"}${url.search}` };
}

async function handleFallback(
  request: IncomingMessage,
  response: ServerResponse,
  fallbackHandler: PersistentPreviewRelayFallbackHandler | undefined,
  onMissing = () => sendText(response, 404, "Preview route not found."),
) {
  if (fallbackHandler) return await fallbackHandler(request, response);
  return onMissing();
}

function createPublicUrl(baseUrl: string, publicDomain: string | undefined, name: string) {
  if (!publicDomain) return `${baseUrl}/preview/${name}`;
  const url = new URL(baseUrl);
  return `${url.protocol}//${name}.${publicDomain}`;
}

function normalizeDomain(value: string | undefined) {
  if (!value) return undefined;
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[:/].*$/, "");
}

function normalizeHost(value: string | string[] | undefined) {
  const host = Array.isArray(value) ? value[0] : value;
  return host?.split(":", 1)[0].trim().toLowerCase().replace(/\.$/, "");
}

function completePendingRequest(
  message: TunnelResponseMessage,
  sessionId: string,
  pending: Map<string, PendingRequest>,
) {
  const entry = pending.get(message.id);
  if (!entry || entry.sessionId !== sessionId) return false;
  pending.delete(message.id);
  clearTimeout(entry.timeout);

  writeTunnelResponse(entry.response, message);
  return true;
}

function writeTunnelResponse(response: ServerResponse, message: TunnelResponseMessage) {
  for (const [name, value] of Object.entries(message.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      response.setHeader(name, value);
    }
  }
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-farm-preview-transport", "websocket");
  response.statusCode = message.status;
  response.end(message.body ? Buffer.from(message.body, "base64") : undefined);
}

function failPendingRequestsForSession(sessionId: string, pending: Map<string, PendingRequest>) {
  for (const [id, entry] of pending) {
    if (entry.sessionId !== sessionId) continue;
    pending.delete(id);
    clearTimeout(entry.timeout);
    sendText(entry.response, 502, "The persistent preview agent disconnected.");
  }
}

function failPendingRequest(id: string, sessionId: string, pending: Map<string, PendingRequest>) {
  const entry = pending.get(id);
  if (!entry || entry.sessionId !== sessionId) return;
  pending.delete(id);
  clearTimeout(entry.timeout);
  sendText(entry.response, 502, "The persistent preview agent disconnected.");
}

function readRequestBody(request: IncomingMessage, maxBodyBytes: number, signal: AbortSignal) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
      request.off("aborted", onRequestAborted);
    };
    const onAbort = () => {
      cleanup();
      request.resume();
      reject(new RequestTimeoutError());
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBodyBytes) {
        cleanup();
        request.resume();
        reject(new BodyLimitError(maxBodyBytes));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.concat(chunks));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onRequestAborted = () => {
      cleanup();
      reject(new Error("Preview request upload was aborted."));
    };

    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    request.once("aborted", onRequestAborted);
  });
}

function normalizeIncomingHeaders(headers: IncomingMessage["headers"]) {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    normalized[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

function sendText(response: ServerResponse, status: number, value: string) {
  if (response.writableEnded || response.destroyed) return;
  if (response.headersSent) {
    response.end();
    return;
  }
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(value);
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function rejectSocketMessage(socket: WebSocket, message: string) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify({ type: "error", message }), () => {
    socket.close(1008, "Invalid tunnel message");
  });
}

function rejectPreviewName(socket: WebSocket, name: string) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(
    JSON.stringify({ type: "error", message: `Preview name "${name}" is already active.` }),
  );
  socket.close(1008, "Preview name unavailable");
}

function listen(server: Server, port: number, host: string) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: Server) {
  if (!server.listening) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function closeWebSocketServer(server: WebSocketServer) {
  return new Promise<void>((resolve) => server.close(() => resolve()));
}

class BodyLimitError extends Error {
  constructor(maxBodyBytes: number) {
    super(`Preview request body exceeds ${maxBodyBytes} bytes.`);
  }
}

class RequestTimeoutError extends Error {
  constructor() {
    super("Preview request upload timed out.");
  }
}
