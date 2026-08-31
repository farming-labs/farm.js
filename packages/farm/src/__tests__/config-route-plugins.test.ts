import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createHeadersPlugin } from "../plugins/headers";
import { createRedirectsPlugin } from "../plugins/redirects";
import { createRewritesPlugin } from "../plugins/rewrites";

function createRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:3000" },
  } as IncomingMessage;
}

function createResponse(): ServerResponse {
  return {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  } as unknown as ServerResponse;
}

async function runBeforeRequest(
  plugin: ReturnType<typeof createRedirectsPlugin>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  await (plugin.beforeRequest as any)(req, res, {});
}

describe("config route plugins", () => {
  it("keeps named and plain redirect captures in source order", async () => {
    const plugin = createRedirectsPlugin([
      {
        source: "/docs/:slug*/asset/*",
        destination: "/new/:slug*/copy/*",
      },
    ]);
    const req = createRequest("/docs/guides/start/asset/logo.svg");
    const res = createResponse();

    await runBeforeRequest(plugin, req, res);

    expect(res.writeHead).toHaveBeenCalledWith(307, {
      Location: "/new/guides/start/copy/logo.svg",
    });
  });

  it("treats regular-expression characters as literals", async () => {
    const plugin = createRedirectsPlugin([{ source: "/promo.html", destination: "/offer" }]);
    const req = createRequest("/promoXhtml");
    const res = createResponse();

    await runBeforeRequest(plugin, req, res);

    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it("matches named parameters when applying response headers", async () => {
    const plugin = createHeadersPlugin([
      {
        source: "/docs/:path*",
        headers: [{ key: "x-docs", value: "yes" }],
      },
    ]);
    const req = createRequest("/docs/guides/start");
    const res = createResponse();

    await runBeforeRequest(plugin, req, res);

    expect(res.setHeader).toHaveBeenCalledWith("x-docs", "yes");
  });

  it("interpolates named and numbered rewrite captures", async () => {
    const named = createRewritesPlugin([
      {
        source: "/api/:version*/assets/*",
        destination: "/internal/:version*/files/*",
      },
    ]);
    const namedRequest = createRequest("/api/v1/public/assets/logo.svg?download=1");

    await runBeforeRequest(named, namedRequest, createResponse());

    expect(namedRequest.url).toBe("/internal/v1/public/files/logo.svg?download=1");

    const numbered = createRewritesPlugin([{ source: "/legacy/*", destination: "/current/$1" }]);
    const numberedRequest = createRequest("/legacy/guide");

    await runBeforeRequest(numbered, numberedRequest, createResponse());

    expect(numberedRequest.url).toBe("/current/guide");
  });
});
