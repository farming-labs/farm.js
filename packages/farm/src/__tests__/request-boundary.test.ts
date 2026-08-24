// @vitest-environment node

import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withFarmRequestTracing } from "../vite";

function createNodeRequest(url: string): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = "GET";
  req.headers = { host: "localhost:3000" };
  return req;
}

function createNodeResponse() {
  const res = new ServerResponse(createNodeRequest("/"));
  const chunks: string[] = [];
  let ended = false;
  Object.defineProperty(res, "writableEnded", { get: () => ended, configurable: true });
  res.setHeader = vi.fn();
  res.end = vi.fn().mockImplementation((chunk?: unknown) => {
    if (typeof chunk === "string") chunks.push(chunk);
    ended = true;
    return res;
  }) as typeof res.end;
  res.destroy = vi.fn().mockReturnValue(res);
  return { res, chunks };
}

async function settle(): Promise<void> {
  // The boundary settles asynchronously; give rejections time to surface.
  for (let i = 0; i < 10; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("dev request boundary", () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(() => {
    process.removeListener("unhandledRejection", onUnhandled);
    unhandled.length = 0;
    vi.restoreAllMocks();
  });

  it("answers 500 when a handler throws synchronously and keeps the process alive", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.on("unhandledRejection", onUnhandled);

    const middleware = withFarmRequestTracing(() => {
      throw new URIError("URI malformed");
    });

    const { res, chunks } = createNodeResponse();
    middleware(createNodeRequest("/docs/caf%E9"), res, () => {});
    await settle();

    expect(res.statusCode).toBe(500);
    expect(chunks.join("")).toContain("Internal server error");
    // The throw must not escape as an unhandled rejection — that is what
    // killed the dev server in #481.
    expect(unhandled).toEqual([]);
  });

  it("answers 500 when a handler rejects asynchronously", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.on("unhandledRejection", onUnhandled);

    const middleware = withFarmRequestTracing(async () => {
      await Promise.resolve();
      throw new Error("async boom");
    });

    const { res, chunks } = createNodeResponse();
    middleware(createNodeRequest("/page"), res, () => {});
    await settle();

    expect(res.statusCode).toBe(500);
    expect(chunks.join("")).toContain("Internal server error");
    expect(unhandled).toEqual([]);
  });

  it("destroys the socket instead of double-sending when headers already went out", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.on("unhandledRejection", onUnhandled);

    const middleware = withFarmRequestTracing(async (_req, res) => {
      (res as { headersSent: boolean }).headersSent = true;
      throw new Error("mid-stream boom");
    });

    const { res } = createNodeResponse();
    Object.defineProperty(res, "headersSent", { value: true, configurable: true });
    middleware(createNodeRequest("/stream"), res, () => {});
    await settle();

    expect(res.destroy).toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
    expect(unhandled).toEqual([]);
  });

  it("leaves successful handlers untouched", async () => {
    const middleware = withFarmRequestTracing(async (_req, res) => {
      res.statusCode = 204;
      res.end();
    });

    const { res } = createNodeResponse();
    middleware(createNodeRequest("/ok"), res, () => {});
    await settle();

    expect(res.statusCode).toBe(204);
  });
});
