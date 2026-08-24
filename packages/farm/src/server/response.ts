import { once } from "node:events";
import type { ServerResponse } from "node:http";

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

  const abort = new AbortController();
  try {
    return await Promise.race([
      once(res, "drain", { signal: abort.signal }).then(() => true),
      once(res, "close", { signal: abort.signal }).then(() => false),
    ]);
  } catch {
    // events.once rejects when the emitter emits "error".
    return false;
  } finally {
    abort.abort();
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

  try {
    while (true) {
      if (res.destroyed) {
        // The client disconnected mid-response; drop the rest of the body so
        // the handler can return.
        await reader.cancel().catch(() => {});
        return;
      }

      const { done, value } = await reader.read();
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
    reader.releaseLock();
  }
}
