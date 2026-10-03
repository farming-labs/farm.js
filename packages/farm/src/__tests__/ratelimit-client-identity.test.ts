// @vitest-environment node
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { middleware } from "../middleware/chain";
import { createContext } from "../middleware/context";

/**
 * The default rate-limit bucket is the caller's address plus the path. Outside a
 * Node server a web Request carries no socket, and production used to report
 * `127.0.0.1` for every visitor, so every caller shared one bucket: one client
 * could exhaust the window for the whole user base while nobody got per-client
 * protection.
 */
function createRequest(address: string | undefined, url = "/api/login"): IncomingMessage {
  const socket = new Socket();
  if (address !== undefined) Object.defineProperty(socket, "remoteAddress", { value: address });
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = "POST";
  req.headers = { host: "localhost:3000" };
  return req;
}

function createResponse(): ServerResponse {
  const res = new ServerResponse(createRequest("127.0.0.1"));
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res;
}

async function runChain(chain: ReturnType<typeof middleware>, address: string | undefined) {
  const ctx = createContext(createRequest(address), createResponse());
  const { handlers } = chain.build();
  let index = 0;
  const next = async (): Promise<void> => {
    if (index < handlers.length) await handlers[index++]!(ctx, next);
  };
  await next();
  return ctx;
}

describe("the default rate-limit bucket needs a real client address", () => {
  it("refuses when the runtime reports no client address", async () => {
    const chain = middleware().rateLimit({ requests: 5, window: "1m" });
    // Bucketing this with every other caller is the bug; the error names the
    // two ways out instead of silently sharing a window.
    await expect(runChain(chain, undefined)).rejects.toThrow(/could not identify the caller/i);
  });

  it("names trustProxy and keyGenerator as the ways out", async () => {
    const chain = middleware().rateLimit({ requests: 5, window: "1m" });
    await expect(runChain(chain, undefined)).rejects.toThrow(/trustProxy[\s\S]*keyGenerator/);
  });

  it("gives two different addresses two different buckets", async () => {
    const chain = middleware().rateLimit({ requests: 1, window: "1m" });
    await runChain(chain, "203.0.113.10");
    const second = await runChain(chain, "198.51.100.77");
    // The second address is not limited by the first one's spent request.
    expect(second.headers.get("RateLimit")).toBe('"farm";r=0;t=60');
  });

  it("still lets a keyGenerator own the bucket with no address available", async () => {
    const chain = middleware().rateLimit({
      requests: 5,
      window: "1m",
      keyGenerator: () => "tenant-a",
    });
    await expect(runChain(chain, undefined)).resolves.toBeDefined();
  });
});
