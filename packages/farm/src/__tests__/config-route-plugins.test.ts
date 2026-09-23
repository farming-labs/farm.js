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

  it("rejects invalid redirect statuses when the plugin is used directly", () => {
    expect(() =>
      createRedirectsPlugin([{ source: "/old", destination: "/new", statusCode: 201 as any }]),
    ).toThrow('Redirect "/old" statusCode must be one of 301, 302, 303, 307, or 308');
  });

  it("rejects route sources that browsers normalize differently", () => {
    for (const source of [
      "/docs/../admin",
      "/docs/%2e%2e/admin",
      "/docs/%2Fadmin",
      "/docs/%5Cadmin",
      "/docs\\admin",
    ]) {
      expect(() => createRedirectsPlugin([{ source, destination: "/safe" }])).toThrow(
        /browser-unstable|backslashes/,
      );
    }
  });

  it("falls back safely when a request carries a malformed Host header", async () => {
    const redirectRequest = createRequest("/old");
    redirectRequest.headers.host = "%";
    const redirectResponse = createResponse();
    await runBeforeRequest(
      createRedirectsPlugin([{ source: "/old", destination: "/new" }]),
      redirectRequest,
      redirectResponse,
    );
    expect(redirectResponse.writeHead).toHaveBeenCalledWith(307, { Location: "/new" });

    const rewriteRequest = createRequest("/legacy");
    rewriteRequest.headers.host = "%";
    await runBeforeRequest(
      createRewritesPlugin([{ source: "/legacy", destination: "/current" }]),
      rewriteRequest,
      createResponse(),
    );
    expect(rewriteRequest.url).toBe("/current");

    const headersRequest = createRequest("/docs");
    headersRequest.headers.host = "%";
    const headersResponse = createResponse();
    await runBeforeRequest(
      createHeadersPlugin([
        { source: "/docs", headers: [{ key: "x-farm-safe-host", value: "1" }] },
      ]),
      headersRequest,
      headersResponse,
    );
    expect(headersResponse.setHeader).toHaveBeenCalledWith("x-farm-safe-host", "1");
  });

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

  it("preserves a redirect query unless the destination declares one", async () => {
    const preserve = createRedirectsPlugin([{ source: "/old", destination: "/new#details" }]);
    const replace = createRedirectsPlugin([
      { source: "/legacy", destination: "/current?view=compact" },
    ]);
    const preserveResponse = createResponse();
    const replaceResponse = createResponse();

    await runBeforeRequest(preserve, createRequest("/old?campaign=launch"), preserveResponse);
    await runBeforeRequest(replace, createRequest("/legacy?view=full"), replaceResponse);

    expect(preserveResponse.writeHead).toHaveBeenCalledWith(307, {
      Location: "/new?campaign=launch#details",
    });
    expect(replaceResponse.writeHead).toHaveBeenCalledWith(307, {
      Location: "/current?view=compact",
    });
  });

  it("keeps wildcard captures root-relative and aligned with production", async () => {
    const plugin = createRedirectsPlugin([{ source: "/old/:path*", destination: "/:path*" }]);
    const response = createResponse();

    await runBeforeRequest(plugin, createRequest("/old//evil.example"), response);

    expect(response.writeHead).toHaveBeenCalledWith(307, {
      Location: "/evil.example",
    });
  });

  it("encodes redirect and rewrite captures like the production runtime", async () => {
    const redirect = createRedirectsPlugin([
      { source: "/legacy/:path*", destination: "/current/:path*" },
    ]);
    const redirectResponse = createResponse();

    await runBeforeRequest(
      redirect,
      createRequest("/legacy/guides/a%20b//c%2Fd"),
      redirectResponse,
    );

    expect(redirectResponse.writeHead).toHaveBeenCalledWith(307, {
      Location: "/current/guides/a%20b/c%2Fd",
    });

    const rewrite = createRewritesPlugin([
      { source: "/legacy/:path*", destination: "/current/$1" },
    ]);
    const rewriteRequest = createRequest("/legacy/guides/a%20b//c%2Fd");
    await runBeforeRequest(rewrite, rewriteRequest, createResponse());
    expect(rewriteRequest.url).toBe("/current/guides/a%20b/c%2Fd");
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

  it("preserves configured and handler Set-Cookie fields", async () => {
    const plugin = createHeadersPlugin([
      {
        source: "/account",
        headers: [
          { key: "Set-Cookie", value: "theme=dark; Path=/" },
          { key: "set-cookie", value: "locale=en; Path=/" },
        ],
      },
    ]);
    const res = createResponse();

    await runBeforeRequest(plugin, createRequest("/account"), res);
    expect(res.getHeader("Set-Cookie")).toEqual(["theme=dark; Path=/", "locale=en; Path=/"]);

    res.writeHead(200, {
      "Set-Cookie": ["session=abc; Path=/; HttpOnly", "notice=seen; Path=/"],
    });

    expect(res.getHeader("Set-Cookie")).toEqual([
      "session=abc; Path=/; HttpOnly",
      "notice=seen; Path=/",
      "theme=dark; Path=/",
      "locale=en; Path=/",
    ]);
  });

  it("does not duplicate configured cookies while finalizing writeHead", async () => {
    const plugin = createHeadersPlugin([
      {
        source: "/account",
        headers: [{ key: "Set-Cookie", value: "theme=dark; Path=/" }],
      },
    ]);
    const res = createResponse();

    await runBeforeRequest(plugin, createRequest("/account"), res);
    res.writeHead(200);

    expect(res.getHeader("Set-Cookie")).toBe("theme=dark; Path=/");
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
