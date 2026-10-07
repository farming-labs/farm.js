import { encodeFarmCacheInvalidations, subscribeFarmCacheInvalidation } from "./cache-invalidation";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_RETRY_MS = 3_000;
const MAX_BUFFERED_BYTES = 64 * 1024;
const MAX_PENDING_KEYS = 1_024;
const textEncoder = new TextEncoder();

export interface FarmCacheInvalidationStreamOptions {
  /** Stop the stream when the owning request is aborted. */
  signal?: AbortSignal;
  /** Limit which invalidation keys this client may observe. */
  filter?: (key: string) => boolean;
  /** SSE heartbeat interval. Set to false to disable heartbeats. */
  heartbeatIntervalMs?: number | false;
  /** EventSource reconnect delay announced to the browser. */
  retryMs?: number;
}

function positiveDuration(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

/**
 * Create an app-owned SSE response that forwards this server instance's cache
 * invalidations. Authenticate the request before calling this helper and use
 * `filter` to keep tenant- or user-scoped keys private.
 */
export function createFarmCacheInvalidationStream(
  options: FarmCacheInvalidationStreamOptions = {},
): Response {
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs === false
      ? false
      : positiveDuration(options.heartbeatIntervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  const retryMs = positiveDuration(options.retryMs, DEFAULT_RETRY_MS);
  let unsubscribe: (() => void) | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let closed = false;
  let flushScheduled = false;
  const pending = new Set<string>();
  let pendingBytes = 0;

  const enqueue = (value: string) => {
    if (closed || !controller) return;
    const chunk = textEncoder.encode(value);
    if (chunk.byteLength > (controller.desiredSize ?? 0)) {
      overflow();
      return;
    }
    controller.enqueue(chunk);
  };

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = undefined;
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
    options.signal?.removeEventListener("abort", abort);
    pending.clear();
    pendingBytes = 0;
  };

  const stop = (closeController: boolean) => {
    if (closed) return;
    closed = true;
    cleanup();
    if (closeController) controller?.close();
  };

  const abort = () => stop(true);

  const overflow = () => {
    if (closed) return;
    stop(false);
    // Erroring discards queued chunks as well as releasing the bus listener.
    // A slow consumer must not retain unbounded output while disconnected.
    controller?.error(new Error("Farm cache invalidation stream exceeded its buffer limit."));
  };

  const flush = () => {
    flushScheduled = false;
    if (closed || pending.size === 0) return;
    const encoded = encodeFarmCacheInvalidations([...pending]);
    pending.clear();
    pendingBytes = 0;
    if (encoded !== null) enqueue(`data: ${encoded}\n\n`);
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(nextController) {
        controller = nextController;
        if (options.signal?.aborted) {
          stop(true);
          return;
        }

        enqueue(`: connected\nretry: ${retryMs}\n\n`);
        unsubscribe = subscribeFarmCacheInvalidation((key) => {
          if (closed || options.filter?.(key) === false) return;
          // A filter may abort its own request. Do not retain work after cleanup.
          if (closed || pending.has(key)) return;
          // Bound the raw UTF-16 strings before encoding or waiting for a microtask.
          if (
            pending.size >= MAX_PENDING_KEYS ||
            pendingBytes + key.length * 2 > MAX_BUFFERED_BYTES
          ) {
            overflow();
            return;
          }
          pending.add(key);
          pendingBytes += key.length * 2;
          if (!flushScheduled) {
            flushScheduled = true;
            queueMicrotask(flush);
          }
        });
        options.signal?.addEventListener("abort", abort, { once: true });
        if (heartbeatIntervalMs !== false) {
          heartbeat = setInterval(() => {
            // Heartbeats are keep-alives, not history to replay to a slow reader.
            if (controller?.desiredSize === MAX_BUFFERED_BYTES) enqueue(": heartbeat\n\n");
          }, heartbeatIntervalMs);
        }
      },
      cancel() {
        stop(false);
      },
    },
    { highWaterMark: MAX_BUFFERED_BYTES, size: (chunk) => chunk.byteLength },
  );

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream; charset=utf-8",
    },
  });
}
