import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

import {
  normalizePreviewName,
  type AgentToRelayMessage,
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
  requestTimeoutMs?: number;
  maxBodyBytes?: number;
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
  timeout: NodeJS.Timeout;
}

export function createPersistentPreviewRelay(options: PersistentPreviewRelayOptions = {}) {
  const agents = new Map<string, AgentSession>();
  const pending = new Map<string, PendingRequest>();
  const websocketServer = new WebSocketServer({ noServer: true });
  const host = options.host || "127.0.0.1";
  const requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
  const maxBodyBytes = options.maxBodyBytes ?? 5 * 1024 * 1024;
  let address: PersistentPreviewRelayAddress | undefined;

  const server = createServer(async (request, response) => {
    try {
      if (request.url === "/api/health") {
        return sendJson(response, 200, { ok: true, transport: "websocket", agents: agents.size });
      }

      const route = resolvePublicRoute(request);
      if (!route) {
        return sendText(response, 404, "Preview route not found.");
      }

      const session = agents.get(route.name);
      if (!session || session.socket.readyState !== session.socket.OPEN) {
        return sendText(
          response,
          404,
          `No active persistent preview is running for "${route.name}".`,
        );
      }

      const body = await readRequestBody(request, maxBodyBytes);
      const id = randomUUID();
      const message: TunnelRequestMessage = {
        type: "request",
        id,
        method: request.method || "GET",
        path: route.path,
        headers: normalizeIncomingHeaders(request.headers),
        ...(body.length ? { body: body.toString("base64") } : {}),
      };

      const timeout = setTimeout(() => {
        pending.delete(id);
        if (!response.headersSent) {
          sendText(response, 504, "The persistent preview agent did not respond in time.");
        }
      }, requestTimeoutMs);

      pending.set(id, { response, timeout });
      session.socket.send(JSON.stringify(message));
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

    socket.on("message", (data) => {
      let message: AgentToRelayMessage;
      try {
        message = JSON.parse(data.toString()) as AgentToRelayMessage;
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "Invalid tunnel message." }));
        return;
      }

      if (message.type === "register") {
        if (session) return;
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
          socket.send(
            JSON.stringify({ type: "error", message: `Preview name "${name}" is already active.` }),
          );
          socket.close(1008, "Preview name unavailable");
          return;
        }

        session = { id: randomUUID(), name, socket };
        agents.set(name, session);
        const baseUrl = options.publicBaseUrl || address?.httpUrl;
        if (!baseUrl) {
          socket.close(1011, "Relay is not listening");
          return;
        }
        const ready: ReadyMessage = {
          type: "ready",
          sessionId: session.id,
          publicUrl: `${baseUrl}/preview/${name}`,
        };
        socket.send(JSON.stringify(ready));
        return;
      }

      if (message.type === "response") {
        completePendingRequest(message, pending);
      }
    });

    socket.on("close", () => {
      if (session && agents.get(session.name)?.id === session.id) {
        agents.delete(session.name);
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
      address = {
        host,
        port: serverAddress.port,
        httpUrl: `http://${displayHost}:${serverAddress.port}`,
        websocketUrl: `ws://${displayHost}:${serverAddress.port}/agent`,
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

function resolvePublicRoute(request: IncomingMessage) {
  const url = new URL(request.url || "/", "http://localhost");
  const match = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/);
  if (!match) return undefined;
  const name = normalizePreviewName(match[1]);
  const path = `${match[2] || "/"}${url.search}`;
  return name ? { name, path } : undefined;
}

function completePendingRequest(
  message: TunnelResponseMessage,
  pending: Map<string, PendingRequest>,
) {
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  clearTimeout(entry.timeout);

  for (const [name, value] of Object.entries(message.headers)) {
    if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
      entry.response.setHeader(name, value);
    }
  }
  entry.response.setHeader("cache-control", "no-store");
  entry.response.setHeader("x-farm-preview-transport", "websocket");
  entry.response.statusCode = message.status;
  entry.response.end(message.body ? Buffer.from(message.body, "base64") : undefined);
}

async function readRequestBody(request: IncomingMessage, maxBodyBytes: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new BodyLimitError(maxBodyBytes);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
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
  if (response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("content-type", "text/plain; charset=utf-8");
  response.end(value);
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
