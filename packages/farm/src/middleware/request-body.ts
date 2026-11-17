import type { IncomingMessage } from "node:http";
import { createWebRequestFromFarmRequest } from "../server/request";
import {
  DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT,
  parseBodySizeLimit,
  readNodeRequestBody,
} from "../server-http";
import type { MiddlewareContext } from "./types";

/** The development server's body size limit for each request, for middleware that reads a body. */
const nodeRequestBodyLimits = new WeakMap<object, number>();

/** @internal Record the body size limit development middleware reads a request's body under. */
export function setFarmMiddlewareRequestBodyLimit(
  request: object,
  limit: number | string | undefined,
): void {
  if (limit === undefined) return;
  try {
    nodeRequestBodyLimits.set(request, parseBodySizeLimit(limit));
  } catch {
    // The server reports an invalid limit itself; middleware reads under the default.
  }
}

/** A ReadableStream that starts its source only when something reads it. */
function createLazyStream(
  open: () => ReadableStream<Uint8Array> | Promise<ReadableStream<Uint8Array>>,
): ReadableStream<Uint8Array> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reader ??= (await open()).getReader();
        const { done, value } = await reader.read();
        if (done) controller.close();
        else controller.enqueue(value);
      },
      cancel(reason) {
        return reader?.cancel(reason);
      },
    },
    // No read ahead: the source opens on the first read, not when the stream is made.
    { highWaterMark: 0 },
  );
}

/** Carry Farm's own properties on a request (the client address `socket`) to its copy. */
function withOwnProperties(copy: Request, original: Request): Request {
  for (const key of Reflect.ownKeys(original)) {
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor && !Object.prototype.hasOwnProperty.call(copy, key)) {
      Object.defineProperty(copy, key, descriptor);
    }
  }
  return copy;
}

function copyRequest(request: Request, body: ReadableStream<Uint8Array>): Request {
  return withOwnProperties(
    new Request(request, { body, duplex: "half" } as RequestInit & { duplex: "half" }),
    request,
  );
}

/**
 * The request a request-first `middleware(request, context)` receives. Reading its body leaves
 * the body for later middleware and the route, as reading a cloned request does, but the body is
 * split only when the middleware reads it, so middleware that never does costs nothing.
 *
 * Development hands middleware the Node request: the body is read once through the server's
 * per-request cache, under its body size limit, which every later reader shares. A production
 * request is a Web Request: the first read tees its body, and `release()` gives the context the
 * copy holding the other half, which the route then reads.
 */
export function createFarmMiddlewareRequest(ctx: MiddlewareContext): {
  request: Request;
  release(): void;
} {
  const source = ctx.request as unknown;
  if (typeof Request !== "undefined" && source instanceof Request) {
    if (!source.body) return { request: source, release() {} };
    let branches: [ReadableStream<Uint8Array>, ReadableStream<Uint8Array>] | undefined;
    const request = copyRequest(
      source,
      createLazyStream(() => (branches ??= source.body!.tee())[0]),
    );
    return {
      request,
      release() {
        if (branches) (ctx as { request: unknown }).request = copyRequest(source, branches[1]);
      },
    };
  }

  const node = source as IncomingMessage;
  const limit = nodeRequestBodyLimits.get(node) ?? DEFAULT_FARM_SERVER_BODY_SIZE_LIMIT;
  const request = createWebRequestFromFarmRequest(node, {
    origin: ctx.url.origin,
    body: createLazyStream(async () => {
      const bytes = await readNodeRequestBody(node, limit);
      return new ReadableStream<Uint8Array>({
        start(controller) {
          if (bytes.byteLength > 0) controller.enqueue(new Uint8Array(bytes));
          controller.close();
        },
      });
    }),
  });
  return { request, release() {} };
}
