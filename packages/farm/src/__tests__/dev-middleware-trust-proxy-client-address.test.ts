// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { memoryRateLimitStorage, middleware } from "../middleware/chain";
import { createContext } from "../middleware/context";

/**
 * Development middleware reads the Node request, whose socket is the proxy's connection. Under
 * `server.trustProxy` the default rate-limit bucket takes the last `X-Forwarded-For` hop, as the
 * production runtime does, instead of putting every proxied visitor in the proxy's bucket.
 */
function createRequest(forwardedFor?: string): IncomingMessage {
  const socket = new Socket();
  Object.defineProperty(socket, "remoteAddress", { value: "10.0.0.2" });
  const req = new IncomingMessage(socket);
  req.url = "/api/login";
  req.method = "POST";
  req.headers = {
    host: "localhost:3000",
    ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
  };
  return req;
}

function createResponse(): ServerResponse {
  const res = new ServerResponse(createRequest());
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res;
}

async function limited(
  chain: ReturnType<typeof middleware>,
  trustProxy: boolean,
  forwardedFor?: string,
): Promise<boolean> {
  const res = createResponse();
  const ctx = createContext(createRequest(forwardedFor), res, undefined, undefined, { trustProxy });
  const { handlers } = chain.build();
  let index = 0;
  let reachedRoute = false;
  const next = async (): Promise<void> => {
    if (index < handlers.length) await handlers[index++]!(ctx, next);
    else reachedRoute = true;
  };
  await next();
  return !reachedRoute;
}

describe("the default rate-limit bucket in development", () => {
  it("takes the trusted proxy's last X-Forwarded-For hop under trustProxy", async () => {
    const chain = middleware().rateLimit({
      requests: 1,
      window: "1m",
      storage: memoryRateLimitStorage(),
    });
    expect(await limited(chain, true, "198.51.100.1")).toBe(false);
    // Another visitor behind the same proxy has a bucket of their own.
    expect(await limited(chain, true, "spoofed, 198.51.100.2")).toBe(false);
    // The same visitor is limited, whatever they put before the proxy's hop.
    expect(await limited(chain, true, "anything, 198.51.100.1")).toBe(true);
  });

  it("ignores X-Forwarded-For without trustProxy", async () => {
    const chain = middleware().rateLimit({
      requests: 1,
      window: "1m",
      storage: memoryRateLimitStorage(),
    });
    expect(await limited(chain, false, "198.51.100.1")).toBe(false);
    // Every caller of this socket shares its address: the header cannot move them.
    expect(await limited(chain, false, "198.51.100.2")).toBe(true);
  });
});
