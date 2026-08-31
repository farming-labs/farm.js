import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createHeadersPlugin } from "../plugins/headers";
import { createRedirectsPlugin } from "../plugins/redirects";
import { createRewritesPlugin } from "../plugins/rewrites";
import { resolveFarmI18nConfig } from "../i18n/config";

function createRequest(url: string): IncomingMessage {
  return {
    url,
    headers: { host: "localhost:3000" },
  } as IncomingMessage;
}

function createResponse(): ServerResponse {
  const headers = new Map<string, number | string | string[]>();
  return {
    setHeader: vi.fn((key: string, value: number | string | readonly string[]) => {
      headers.set(key.toLowerCase(), Array.isArray(value) ? [...value] : value);
    }),
    getHeader: vi.fn((key: string) => headers.get(key.toLowerCase())),
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
  const i18n = resolveFarmI18nConfig(
    {
      locales: ["en", "fr"],
      defaultLocale: "en",
      routing: "prefix-except-default",
    },
    { root: "/tmp/farm-config-route-i18n", mode: "development" },
  );

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

  it("finalizes configured headers after handler headers like production", async () => {
    const plugin = createHeadersPlugin([
      {
        source: "/docs/:path*",
        headers: [
          { key: "cache-control", value: "public, max-age=60" },
          { key: "Link", value: "</configured.css>; rel=preload; as=style" },
        ],
      },
    ]);
    const req = createRequest("/docs/start");
    const res = createResponse();

    await runBeforeRequest(plugin, req, res);
    res.setHeader("cache-control", "private");
    res.writeHead(200, {
      "cache-control": "no-store",
      Link: "</handler.js>; rel=preload; as=script",
    });

    expect(res.getHeader("cache-control")).toBe("public, max-age=60");
    expect(res.getHeader("Link")).toBe(
      "</handler.js>; rel=preload; as=script, </configured.css>; rel=preload; as=style",
    );
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

  it("uses a rewrite destination query instead of appending the source query", async () => {
    const plugin = createRewritesPlugin([
      {
        source: "/legacy",
        destination: "/current?view=compact",
      },
    ]);
    const req = createRequest("/legacy?view=full&page=2");

    await runBeforeRequest(plugin, req, createResponse());

    expect(req.url).toBe("/current?view=compact");
  });

  it("matches locale-prefixed config routes and localizes their destinations", async () => {
    const redirect = createRedirectsPlugin(
      [{ source: "/docs/:path*", destination: "/learn/:path*" }],
      { i18n },
    );
    const redirectRequest = createRequest("/fr/docs/start");
    const redirectResponse = createResponse();

    await runBeforeRequest(redirect, redirectRequest, redirectResponse);

    expect(redirectResponse.writeHead).toHaveBeenCalledWith(307, {
      Location: "/fr/learn/start",
    });

    const rewrite = createRewritesPlugin(
      [{ source: "/legacy/:path*", destination: "/current/:path*" }],
      { i18n },
    );
    const rewriteRequest = createRequest("/fr/legacy/guide?view=full");
    await runBeforeRequest(rewrite, rewriteRequest, createResponse());
    expect(rewriteRequest.url).toBe("/fr/current/guide?view=full");

    const headers = createHeadersPlugin(
      [{ source: "/docs/:path*", headers: [{ key: "x-docs", value: "yes" }] }],
      { i18n },
    );
    const headerResponse = createResponse();
    await runBeforeRequest(headers, createRequest("/fr/docs/start"), headerResponse);
    expect(headerResponse.getHeader("x-docs")).toBe("yes");
  });
});
