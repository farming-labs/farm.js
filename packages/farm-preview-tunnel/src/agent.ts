import { WebSocket } from "ws";

import type {
  ReadyMessage,
  RelayToAgentMessage,
  TunnelRequestMessage,
  TunnelResponseMessage,
} from "./protocol.js";
import { isRelayToAgentMessage } from "./protocol.js";
import { getHopByHopHeaderNames, getRecordHeader } from "./headers.js";

export interface TypeScriptPreviewAgentOptions {
  relayUrl: string;
  name: string;
  targetUrl: string;
  connectTimeoutMs?: number;
  localProbeIntervalMs?: number;
  localProbeTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxResponseBodyBytes?: number;
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
  const onSocketError = () => {
    // WebSocket errors are followed by close; keep a listener for the socket's full lifetime.
  };
  socket.on("error", onSocketError);

  let ready: ReadyMessage;
  try {
    ready = await waitForReady(socket, options);
  } catch (error) {
    await terminateSocket(socket);
    socket.off("error", onSocketError);
    throw error;
  }

  const inFlight = new Map<string, AbortController>();
  const maxResponseBodyBytes = Math.min(
    options.maxResponseBodyBytes ?? Number.POSITIVE_INFINITY,
    ready.maxResponseBodyBytes ?? 5 * 1024 * 1024,
  );
  const stopWatchingTarget = watchLocalTarget(socket, options);
  const abortInFlight = () => {
    for (const controller of inFlight.values()) controller.abort();
    inFlight.clear();
  };

  socket.on("message", (data) => {
    const message = parseRelayMessage(data);
    if (!message) {
      socket.close(1008, "Invalid relay message");
      return;
    }
    if (message.type === "request") {
      const controller = new AbortController();
      inFlight.get(message.id)?.abort();
      inFlight.set(message.id, controller);
      void forwardRequest(socket, options, message, controller, maxResponseBodyBytes).finally(
        () => {
          if (inFlight.get(message.id) === controller) inFlight.delete(message.id);
        },
      );
    } else if (message.type === "cancel") {
      inFlight.get(message.id)?.abort();
      inFlight.delete(message.id);
    }
  });
  socket.once("close", () => {
    stopWatchingTarget();
    abortInFlight();
    socket.off("error", onSocketError);
  });

  return {
    sessionId: ready.sessionId,
    publicUrl: ready.publicUrl,
    async close() {
      stopWatchingTarget();
      abortInFlight();
      await closeSocket(socket);
    },
  };
}

function watchLocalTarget(socket: WebSocket, options: TypeScriptPreviewAgentOptions) {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let probeController: AbortController | undefined;
  const intervalMs = options.localProbeIntervalMs ?? 2_000;
  const timeoutMs = options.localProbeTimeoutMs ?? 1_000;

  const stop = () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    probeController?.abort();
  };
  const probe = async () => {
    if (stopped) return;
    const controller = new AbortController();
    probeController = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(options.targetUrl, { signal: controller.signal });
      await response.body?.cancel();
      timer = setTimeout(probe, intervalMs);
    } catch {
      if (stopped) return;
      stop();
      if (socket.readyState === socket.OPEN) {
        socket.close(1001, "Local preview target stopped");
      }
    } finally {
      clearTimeout(timeout);
      if (probeController === controller) probeController = undefined;
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
      const message = parseRelayMessage(data);
      if (!message) {
        cleanup();
        reject(new Error("Persistent preview relay sent an invalid handshake message."));
        return;
      }
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

async function forwardRequest(
  socket: WebSocket,
  options: TypeScriptPreviewAgentOptions,
  request: TunnelRequestMessage,
  controller: AbortController,
  maxResponseBodyBytes: number,
) {
  let response: TunnelResponseMessage;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.requestTimeoutMs ?? 30_000);

  try {
    const headers = new Headers();
    const requestHopByHopHeaders = getHopByHopHeaderNames(
      getRecordHeader(request.headers, "connection"),
    );
    for (const [name, value] of Object.entries(request.headers)) {
      if (!requestHopByHopHeaders.has(name.toLowerCase())) headers.set(name, value);
    }
    const method = request.method.toUpperCase();
    const result = await fetch(resolveTargetUrl(options.targetUrl, request.path), {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD" || !request.body
          ? undefined
          : Buffer.from(request.body, "base64"),
      redirect: "manual",
      signal: controller.signal,
    });
    const responseHeaders: Record<string, string | string[]> = {};
    const responseHopByHopHeaders = getHopByHopHeaderNames(result.headers.get("connection"));
    for (const [name, value] of result.headers) {
      const normalizedName = name.toLowerCase();
      if (
        normalizedName !== "content-encoding" &&
        normalizedName !== "set-cookie" &&
        !responseHopByHopHeaders.has(normalizedName)
      ) {
        responseHeaders[name] = value;
      }
    }
    const setCookies = getSetCookies(result.headers);
    if (setCookies.length) responseHeaders["set-cookie"] = setCookies;
    const responseBody = await readResponseBody(result, maxResponseBodyBytes);
    response = {
      type: "response",
      id: request.id,
      status: result.status,
      headers: responseHeaders,
      body: responseBody.toString("base64"),
    };
  } catch (error) {
    if (controller.signal.aborted && !timedOut) return;
    const unsafePath = error instanceof UnsafePreviewPathError;
    response = {
      type: "response",
      id: request.id,
      status: timedOut ? 504 : unsafePath ? 400 : 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
      body: Buffer.from(error instanceof Error ? error.message : String(error)).toString("base64"),
    };
  } finally {
    clearTimeout(timeout);
  }

  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(response));
}

async function readResponseBody(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (
    !response.headers.has("content-encoding") &&
    Number.isFinite(contentLength) &&
    contentLength > maxBytes
  ) {
    await response.body?.cancel();
    throw new PreviewResponseLimitError(maxBytes);
  }
  if (!response.body) return Buffer.alloc(0);

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PreviewResponseLimitError(maxBytes);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return Buffer.concat(chunks, size);
}

function parseRelayMessage(data: WebSocket.RawData): RelayToAgentMessage | undefined {
  try {
    const value: unknown = JSON.parse(data.toString());
    return isRelayToAgentMessage(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function resolveTargetUrl(targetUrl: string, requestPath: string) {
  if (!requestPath.startsWith("/") || /^[/\\]{2}/.test(requestPath)) {
    throw new UnsafePreviewPathError();
  }

  const base = new URL(targetUrl);
  if (base.protocol !== "http:" && base.protocol !== "https:") {
    throw new UnsafePreviewPathError();
  }
  base.pathname = ensureTrailingSlash(base.pathname);
  base.search = "";
  base.hash = "";
  const resolved = new URL(requestPath.slice(1), base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new UnsafePreviewPathError();
  }
  return resolved;
}

function getSetCookies(headers: Headers) {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  return getSetCookie?.call(headers) || [];
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

class PreviewResponseLimitError extends Error {
  constructor(maxBytes: number) {
    super(`The local preview response exceeded the ${maxBytes} byte limit.`);
    this.name = "PreviewResponseLimitError";
  }
}

function closeSocket(socket: WebSocket) {
  if (socket.readyState === socket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.close(1000, "Preview agent stopped");
  });
}

function terminateSocket(socket: WebSocket) {
  if (socket.readyState === socket.CLOSED) return Promise.resolve();
  return new Promise<void>((resolve) => {
    socket.once("close", () => resolve());
    socket.terminate();
  });
}

class UnsafePreviewPathError extends Error {
  constructor() {
    super("Preview request path cannot change the local target authority.");
  }
}
