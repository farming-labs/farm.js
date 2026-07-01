import { once } from "node:events";
import type { ServerResponse } from "node:http";

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
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value || value.byteLength === 0) {
        continue;
      }

      if (!res.write(value)) {
        await once(res, "drain");
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
