import { WebSocket } from "ws";

import type {
  ReadyMessage,
  RelayToAgentMessage,
  TunnelRequestMessage,
  TunnelResponseMessage,
} from "./protocol.js";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export interface TypeScriptPreviewAgentOptions {
  relayUrl: string;
  name: string;
  targetUrl: string;
  connectTimeoutMs?: number;
  localProbeIntervalMs?: number;
  localProbeTimeoutMs?: number;
}

export interface TypeScriptPreviewAgent {
  sessionId: string;
  publicUrl: string;
  close(): Promise<void>;
}

export async function startTypeScriptPreviewAgent(
  options: TypeScriptPreviewAgentOptions,
): Promise<TypeScriptPreviewAgent> {
  const socket = new WebSocket(options.relayUrl);
  const ready = await waitForReady(socket, options);
  const stopWatchingTarget = watchLocalTarget(socket, options);

  socket.on("message", (data) => {
    const message = JSON.parse(data.toString()) as RelayToAgentMessage;
    if (message.type === "request") {
      void forwardRequest(socket, options.targetUrl, message);
    }
  });

  return {
    sessionId: ready.sessionId,
    publicUrl: ready.publicUrl,
    async close() {
      stopWatchingTarget();
      await closeSocket(socket);
    },
  };
}

function watchLocalTarget(socket: WebSocket, options: TypeScriptPreviewAgentOptions) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  const intervalMs = options.localProbeIntervalMs ?? 2_000;
  const timeoutMs = options.localProbeTimeoutMs ?? 1_000;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
  const probe = async () => {
    if (stopped) return;
    try {
      await fetch(options.targetUrl, { signal: AbortSignal.timeout(timeoutMs) });
      timer = setTimeout(probe, intervalMs);
    } catch {
      stop();
      if (socket.readyState === socket.OPEN) {
        socket.close(1001, "Local preview target stopped");
      }
    }
  };

  socket.once("close", stop);
  timer = setTimeout(probe, intervalMs);
  return stop;
}

function waitForReady(socket: WebSocket, options: TypeScriptPreviewAgentOptions) {
  return new Promise<ReadyMessage>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error("Persistent preview relay did not accept the agent in time."));
    }, options.connectTimeoutMs ?? 10_000);

    const onOpen = () => {
      socket.send(JSON.stringify({ type: "register", name: options.name }));
    };
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as RelayToAgentMessage;
      if (message.type === "ready") {
        cleanup();
        resolve(message);
      } else if (message.type === "error") {
        cleanup();
        reject(new Error(message.message));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Persistent preview relay closed before the agent was ready."));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off("open", onOpen);
      socket.off("message", onMessage);
      socket.off("error", onError);
      socket.off("close", onClose);
    };

    socket.on("open", onOpen);
    socket.on("message", onMessage);
    socket.on("error", onError);
    socket.on("close", onClose);
  });
}

async function forwardRequest(socket: WebSocket, targetUrl: string, request: TunnelRequestMessage) {
  let response: TunnelResponseMessage;
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
    const method = request.method.toUpperCase();
    const result = await fetch(new URL(request.path, ensureTrailingSlash(targetUrl)), {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD" || !request.body
          ? undefined
          : Buffer.from(request.body, "base64"),
      redirect: "manual",
    });
    const responseHeaders: Record<string, string> = {};
    for (const [name, value] of result.headers) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) responseHeaders[name] = value;
    }
    response = {
      type: "response",
      id: request.id,
      status: result.status,
      headers: responseHeaders,
      body: Buffer.from(await result.arrayBuffer()).toString("base64"),
    };
  } catch (error) {
    response = {
      type: "response",
      id: request.id,
      status: 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: Buffer.from(error instanceof Error ? error.message : String(error)).toString("base64"),
    };
  }

  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(response));
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function closeSocket(socket: WebSocket) {
  if (socket.readyState === socket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close(1000, "Preview agent stopped");
  });
}
