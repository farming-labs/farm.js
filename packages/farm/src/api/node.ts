import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import {
  mountFetchHandler,
  type MountedFetchRouteHandlers,
  type MountFetchHandlerOptions,
} from "./mount";

/**
 * A Node.js request listener: an Express or Connect app, `koa.callback()`, a Nest app's HTTP
 * adapter instance, or any `(req, res) => void` function.
 */
export type NodeRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  next?: (error?: unknown) => void,
) => unknown;

export type MountNodeHandlerOptions = MountFetchHandlerOptions;

/**
 * Mount a Node.js request listener, such as an Express, Koa, Fastify or Nest app, on an API route.
 * Export the methods the app handles from the returned handlers:
 *
 * ```ts
 * export const { GET, POST, PUT, PATCH, DELETE } = mountNodeHandler(app);
 * ```
 *
 * Pass a promise for frameworks that finish starting asynchronously, such as Nest. The listener
 * runs against an in-memory `req` and `res`: the app reads the request body as a stream and its
 * response streams back as soon as it sends headers. Requires a Node.js-compatible runtime.
 */
export function mountNodeHandler(
  handler: NodeRequestHandler | Promise<NodeRequestHandler>,
  options: MountNodeHandlerOptions = {},
): MountedFetchRouteHandlers {
  // A handler that is clearly wrong fails where the route module is loaded.
  if (typeof (handler as Promise<unknown>)?.then !== "function") assertNodeRequestHandler(handler);
  const ready = Promise.resolve(handler).then(assertNodeRequestHandler);
  // A failed start rejects each request instead of crashing the process at import time.
  ready.catch(() => {});
  return mountFetchHandler(async (request) => callNodeHandler(await ready, request), options);
}

function assertNodeRequestHandler(handler: unknown): NodeRequestHandler {
  if (typeof handler === "function") return handler as NodeRequestHandler;
  throw new TypeError(
    "mountNodeHandler expects a Node.js (req, res) listener. Pass koa.callback() for Koa, and " +
      '(req, res) => fastify.server.emit("request", req, res) after fastify.ready() for Fastify.',
  );
}

/** Hop-by-hop headers Node writes for its own connection; the server answering the client owns them. */
const CONNECTION_HEADERS = new Set(["connection", "keep-alive", "transfer-encoding"]);
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

type ServerResponseInternals = ServerResponse & { _header?: string | null };

function callNodeHandler(handler: NodeRequestHandler, request: Request): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const url = new URL(request.url);
    const socket = createSocket(url);
    const req = createIncomingMessage(socket, request, url);
    const res = new ServerResponse(req) as ServerResponseInternals;
    res.sendDate = false;
    res.assignSocket(socket as never);

    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let settled = false;
    let ended = false;

    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        reject(error);
      } else if (!ended) {
        ended = true;
        controller?.error(error);
      }
    };

    // Called once Node has committed the status line and headers, on the first write, end or
    // flushHeaders. `_header` is the exact block Node would send, so headers set through
    // setHeader, writeHead (object or raw array) and repeated Set-Cookie values all carry over.
    const respond = () => {
      if (settled) return;
      settled = true;
      const headers = parseHeaderBlock(res._header ?? "");
      const body = NULL_BODY_STATUSES.has(res.statusCode)
        ? null
        : new ReadableStream<Uint8Array>({
            start(streamController) {
              controller = streamController;
              if (ended) streamController.close();
            },
            cancel() {
              res.destroy();
              req.destroy();
            },
          });
      resolve(
        new Response(body, {
          status: res.statusCode,
          statusText: res.statusMessage,
          headers,
        }),
      );
    };

    const capture = (chunk: unknown, encoding?: unknown) => {
      if (chunk == null || typeof chunk === "function") return;
      const bytes =
        typeof chunk === "string"
          ? Buffer.from(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8")
          : chunk instanceof Uint8Array
            ? chunk
            : Buffer.from(String(chunk));
      if (bytes.byteLength > 0) controller?.enqueue(new Uint8Array(bytes));
    };

    // Own properties, not a subclass: Express and Nest replace the response's prototype with their
    // own, and an own property survives that while still running Node's bookkeeping underneath.
    const write = ServerResponse.prototype.write;
    const end = ServerResponse.prototype.end;
    const flushHeaders = ServerResponse.prototype.flushHeaders;
    res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
      const result = (write as (...args: unknown[]) => boolean).call(this, chunk, ...rest);
      respond();
      capture(chunk, rest[0]);
      return result;
    } as ServerResponse["write"];
    res.end = function (this: ServerResponse, chunk?: unknown, ...rest: unknown[]) {
      if (ended) return this;
      (end as (...args: unknown[]) => unknown).call(this, chunk, ...rest);
      respond();
      capture(chunk, rest[0]);
      ended = true;
      controller?.close();
      return this;
    } as ServerResponse["end"];
    res.flushHeaders = function (this: ServerResponse) {
      flushHeaders.call(this);
      respond();
    };

    res.once("close", () => {
      if (!ended) fail(new Error("The response closed before it ended."));
    });
    req.once("error", fail);
    request.signal?.addEventListener(
      "abort",
      () => {
        req.destroy();
        res.destroy();
      },
      { once: true },
    );

    // Connect-style handlers call next() when no route matched, or next(error) on failure.
    const next = (error?: unknown) => {
      if (error) fail(error);
      else if (!settled) {
        res.statusCode = 404;
        res.end();
      }
    };

    try {
      const result = handler(req, res, next);
      if (result && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).then(undefined, fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

function createSocket(url: URL): Duplex {
  const socket = new Duplex({
    read() {},
    write(_chunk, _encoding, callback) {
      // The response bytes are captured before Node frames them; the framed copy is discarded.
      callback();
    },
  });
  return Object.assign(socket, {
    encrypted: url.protocol === "https:",
    remoteAddress: undefined,
    setTimeout: () => socket,
    setNoDelay: () => socket,
    setKeepAlive: () => socket,
  });
}

function createIncomingMessage(socket: Duplex, request: Request, url: URL): IncomingMessage {
  const req = new IncomingMessage(socket as never);
  req.method = request.method;
  req.url = `${url.pathname}${url.search}`;
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  const headers: Record<string, string | string[]> = {};
  const rawHeaders: string[] = [];
  request.headers.forEach((value, name) => {
    if (name === "set-cookie") return;
    headers[name] = value;
    rawHeaders.push(name, value);
  });
  if (!headers.host) {
    headers.host = url.host;
    rawHeaders.push("host", url.host);
  }
  // A Node server always sees a body framed by one of these. Body parsers such as Express's skip
  // a request that has neither, so a streamed body of unknown length is presented as chunked.
  if (request.body && !headers["content-length"] && !headers["transfer-encoding"]) {
    headers["transfer-encoding"] = "chunked";
    rawHeaders.push("transfer-encoding", "chunked");
  }
  req.headers = headers;
  req.rawHeaders = rawHeaders;

  // Pull the body one chunk per read, so the app's consumption sets the pace.
  const reader = request.body?.getReader();
  const nodeRead = IncomingMessage.prototype._read;
  let pulling = false;
  req._read = (size: number) => {
    // Node's own _read marks the message as being consumed, which lets the stream keep asking for
    // more data after each chunk. The socket it would resume is the inert one above.
    nodeRead.call(req, size);
    if (!reader) {
      req.complete = true;
      req.push(null);
      return;
    }
    // Node can ask again before the previous read settles; one read at a time keeps chunks ordered.
    if (pulling) return;
    pulling = true;
    reader.read().then(
      ({ done, value }) => {
        pulling = false;
        if (done) {
          req.complete = true;
          req.push(null);
        } else {
          req.push(Buffer.from(value));
        }
      },
      (error) => req.destroy(error),
    );
  };
  return req;
}

function parseHeaderBlock(block: string): Headers {
  const headers = new Headers();
  // The first line is the status line; the block ends with an empty line.
  for (const line of block.split("\r\n").slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim();
    if (CONNECTION_HEADERS.has(name.toLowerCase())) continue;
    headers.append(name, line.slice(separator + 1).trim());
  }
  return headers;
}
