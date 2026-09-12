import type { ServerResponse } from "node:http";

interface ResponseEventWatcher<T> {
  promise: Promise<T>;
  dispose(): void;
}

/**
 * Watch a real Node response without requiring every Node-compatible response
 * adapter or test double to extend EventEmitter. The framework only needs
 * disconnect handling when the response exposes both halves of the listener
 * lifecycle; otherwise callers can still send ordinary non-blocked bodies.
 */
function watchResponseEvent<T>(
  res: ServerResponse,
  events: ReadonlyArray<readonly [event: string, value: T]>,
): ResponseEventWatcher<T> | null {
  if (typeof res.once !== "function" || typeof res.removeListener !== "function") {
    return null;
  }

  let settled = false;
  const listeners = events.map(([event, value]) => {
    const listener = () => {
      if (settled) return;
      settled = true;
      dispose();
      resolvePromise(value);
    };
    return { event, listener };
  });
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
    for (const { event, listener } of listeners) {
      res.once(event, listener);
    }
  });
  const dispose = () => {
    for (const { event, listener } of listeners) {
      res.removeListener(event, listener);
    }
  };

  return { promise, dispose };
}

/**
 * Waits until the response can accept more writes. Resolves false when the
 * client is gone (close or error): a disconnected socket never emits drain,
 * so waiting on drain alone leaks the pending handler, its reader lock, and
 * the response body for the life of the process.
 */
async function waitForWritable(res: ServerResponse): Promise<boolean> {
  if (res.writableEnded || res.destroyed) {
    return false;
  }

  const watcher = watchResponseEvent(res, [
    ["drain", true],
    ["close", false],
    ["error", false],
  ]);
  if (!watcher) {
    return false;
  }

  try {
    return await watcher.promise;
  } finally {
    watcher.dispose();
  }
}

/**
 * Older Fetch implementations expose repeated Set-Cookie fields as one
 * comma-joined value. Split only at a comma followed by another cookie-pair;
 * commas inside Expires dates remain part of the current cookie. RFC cookie
 * values exclude commas, so a comma followed by a cookie-pair is unambiguous
 * for valid Set-Cookie syntax once the original field boundaries are lost.
 */
function splitSetCookieHeader(value: string): string[] {
  const cookies: string[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== ",") continue;

    let next = index + 1;
    while (value[next] === " " || value[next] === "\t") next += 1;

    const equals = value.indexOf("=", next);
    if (equals === -1) continue;

    const separator = value.slice(next, equals);
    if (separator.length === 0 || /[;,\s]/.test(separator)) continue;

    cookies.push(value.slice(start, index).trim());
    start = next;
    index = next - 1;
  }

  cookies.push(value.slice(start).trim());
  return cookies.filter(Boolean);
}

export function applyWebResponseHeaders(
  res: Pick<ServerResponse, "setHeader"> & Partial<Pick<ServerResponse, "getHeader">>,
  headers: Headers,
  options: { appendSetCookie?: boolean } = {},
): void {
  const responseHeaders = headers as Headers & {
    getSetCookie?: () => string[];
    raw?: () => Record<string, string[]>;
  };
  const rawSetCookies = responseHeaders.raw?.()["set-cookie"];
  const setCookies = responseHeaders.getSetCookie?.() || rawSetCookies || [];
  const existing =
    options.appendSetCookie && typeof res.getHeader === "function"
      ? res.getHeader("Set-Cookie")
      : undefined;
  const existingCookies = Array.isArray(existing)
    ? existing.map(String)
    : existing === undefined
      ? []
      : [String(existing)];

  let fallbackSetCookie = "";
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      fallbackSetCookie = value;
      return;
    }
    res.setHeader(key, value);
  });

  const cookies =
    setCookies.length > 0
      ? setCookies
      : fallbackSetCookie
        ? splitSetCookieHeader(fallbackSetCookie)
        : [];
  if (cookies.length > 0) {
    res.setHeader("Set-Cookie", [...existingCookies, ...cookies]);
  }
}

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  applyWebResponseHeaders(res, response.headers, { appendSetCookie: true });

  if (!response.body) {
    res.end();
    return;
  }

  if (typeof res.write !== "function") {
    const body = await response.arrayBuffer();
    res.end(Buffer.from(body));
    return;
  }

  const reader = response.body.getReader();
  const disconnectWatcher = watchResponseEvent(res, [
    ["close", true],
    ["error", true],
  ]);

  try {
    while (true) {
      if (res.destroyed) {
        // The client disconnected mid-response; drop the rest of the body so
        // the handler can return.
        void reader.cancel().catch(() => {});
        return;
      }

      const read = reader.read().then((result) => ({ type: "read" as const, result }));
      const next = disconnectWatcher
        ? await Promise.race([
            read,
            disconnectWatcher.promise.then(() => ({ type: "disconnect" as const })),
          ])
        : await read;
      if (next.type === "disconnect") {
        void reader.cancel().catch(() => {});
        return;
      }

      const { done, value } = next.result;
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      if (!res.write(value)) {
        if (!(await waitForWritable(res))) {
          void reader.cancel().catch(() => {});
          return;
        }
      }
    }

    res.end();
  } catch (error) {
    // Releasing the lock does not stop the producer. Cancel it when the
    // downstream write fails, without waiting on app-owned cleanup or letting
    // a cancellation failure replace the original error.
    void reader.cancel(error).catch(() => {});
    if (!res.writableEnded) {
      const responseError = error instanceof Error ? error : new Error(String(error));
      if (typeof res.destroy === "function") {
        res.destroy(responseError);
      } else {
        res.end();
      }
    }
    throw error;
  } finally {
    disconnectWatcher?.dispose();
    try {
      reader.releaseLock();
    } catch {
      // A disconnect can win the race with a pending read. Cancelling the
      // reader settles it asynchronously, so there may be no lock to release
      // synchronously here.
    }
  }
}
