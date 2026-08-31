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

export async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;

  const responseHeaders = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const setCookies = responseHeaders.getSetCookie?.() || [];
  if (setCookies.length > 0) {
    res.setHeader("Set-Cookie", setCookies);
  }

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie" && setCookies.length > 0) {
      return;
    }
    res.setHeader(key, value);
  });

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
        await reader.cancel().catch(() => {});
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
          await reader.cancel().catch(() => {});
          return;
        }
      }
    }

    res.end();
  } catch (error) {
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
