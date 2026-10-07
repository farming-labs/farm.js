// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it } from "vitest";
import { renderFarmLocaleAlternateLinks } from "../i18n/alternates";
import { resolveFarmI18nConfig } from "../i18n/config";
import { stripFarmLocaleFromPathname } from "../i18n/routing";
import { FarmI18nRuntime } from "../i18n/runtime";
import { REACT_RENDERER } from "../renderer";
import { ServerRenderer } from "../server/renderer";
import { resolveFarmWebRequestOrigin } from "../server/request";
import type { FarmRequest, FarmResponse } from "../types";

const locales = {
  locales: ["en", "fr"],
  defaultLocale: "en",
  routing: "prefix-except-default",
} as const;

function alternates(html: string): Record<string, string> {
  return Object.fromEntries(
    Array.from(
      html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]*)">/g),
      (match) => [match[1], match[2]],
    ),
  );
}

describe("renderFarmLocaleAlternateLinks", () => {
  it("resolves every locale and x-default against the request origin", () => {
    expect(
      alternates(
        renderFarmLocaleAlternateLinks("/fr/pricing", locales, { origin: "https://farm.test" }),
      ),
    ).toEqual({
      en: "https://farm.test/pricing",
      fr: "https://farm.test/fr/pricing",
      "x-default": "https://farm.test/pricing",
    });
  });

  it("prefers metadataBase over the request origin", () => {
    for (const metadataBase of ["https://www.example.com", new URL("https://www.example.com")]) {
      expect(
        alternates(
          renderFarmLocaleAlternateLinks("/pricing", locales, {
            metadataBase,
            origin: "http://internal:3000",
          }),
        ),
      ).toEqual({
        en: "https://www.example.com/pricing",
        fr: "https://www.example.com/fr/pricing",
        "x-default": "https://www.example.com/pricing",
      });
    }
  });

  it("falls back to the request origin when metadataBase is not an absolute http(s) URL", () => {
    for (const metadataBase of ["/docs", "javascript:alert(1)", 42]) {
      expect(
        alternates(
          renderFarmLocaleAlternateLinks("/pricing", locales, {
            metadataBase,
            origin: "https://farm.test",
          }),
        ).fr,
      ).toBe("https://farm.test/fr/pricing");
    }
  });

  it("keeps the base path and the always-prefixed default locale", () => {
    expect(
      alternates(
        renderFarmLocaleAlternateLinks(
          "/app/en",
          { ...locales, routing: "prefix-always", basePath: "/app" },
          { origin: "https://farm.test" },
        ),
      ),
    ).toEqual({
      en: "https://farm.test/app/en",
      fr: "https://farm.test/app/fr",
      "x-default": "https://farm.test/app/en",
    });
  });

  it("keeps a path that resolves to another authority on the base host", () => {
    expect(
      alternates(
        renderFarmLocaleAlternateLinks("//evil.test/pricing", locales, {
          origin: "https://farm.test",
        }),
      ),
    ).toEqual({
      en: "https://farm.test/evil.test/pricing",
      fr: "https://farm.test/fr/evil.test/pricing",
      "x-default": "https://farm.test/evil.test/pricing",
    });
  });

  it("emits paths when neither metadataBase nor a request origin is known", () => {
    expect(alternates(renderFarmLocaleAlternateLinks("/fr/pricing", locales))).toEqual({
      en: "/pricing",
      fr: "/fr/pricing",
      "x-default": "/pricing",
    });
  });

  it("emits nothing when URLs carry no locale", () => {
    expect(
      renderFarmLocaleAlternateLinks(
        "/pricing",
        { ...locales, routing: "none" },
        { origin: "https://farm.test" },
      ),
    ).toBe("");
  });
});

describe("resolveFarmWebRequestOrigin", () => {
  const forwarded = new Request("http://internal:3000/fr/pricing", {
    headers: {
      "x-forwarded-host": "app.example.com, internal:3000",
      "x-forwarded-proto": "HTTPS, http",
    },
  });

  it("uses the adapter URL and ignores forwarded authority without trustProxy", () => {
    expect(resolveFarmWebRequestOrigin(forwarded)).toBe("http://internal:3000");
    expect(resolveFarmWebRequestOrigin(forwarded, { trustProxy: false })).toBe(
      "http://internal:3000",
    );
  });

  it("uses the first forwarded host and protocol under trustProxy", () => {
    expect(resolveFarmWebRequestOrigin(forwarded, { trustProxy: true })).toBe(
      "https://app.example.com",
    );
  });

  it("keeps the adapter authority for malformed forwarded values under trustProxy", () => {
    const request = new Request("https://farm.test/pricing", {
      headers: { "x-forwarded-host": "evil.test/path", "x-forwarded-proto": "javascript" },
    });
    expect(resolveFarmWebRequestOrigin(request, { trustProxy: true })).toBe("https://farm.test");
  });
});

// The production handler is emitted from a template literal, so the i18n
// document helpers are extracted from the source, un-escaped, and run against
// the same core exports the built server imports.
function createProductionI18nDocument(trustProxy: boolean) {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
    "utf-8",
  );
  const start = source.indexOf("function resolveFarmI18nAlternateOrigin(request)");
  const end = source.indexOf("function appendFarmVary(headers, value)", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const emitted = source.slice(start, end).replace(/\\([\\`$])/g, "$1");
  return new Function(
    "farmServerConfig",
    "resolveFarmWebRequestOrigin",
    "stripFarmLocaleFromPathname",
    "renderFarmLocaleAlternateLinks",
    "escapeFarmHtmlAttribute",
    "serializeFarmInlineValue",
    `${emitted}\nreturn applyFarmI18nDocument;`,
  )(
    { trustProxy },
    resolveFarmWebRequestOrigin,
    stripFarmLocaleFromPathname,
    renderFarmLocaleAlternateLinks,
    (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;"),
    (value: unknown) => JSON.stringify(value),
  ) as (
    html: string,
    requestPath: string,
    snapshot: unknown,
    request?: Request,
    metadata?: Record<string, unknown>,
  ) => string;
}

function createProductionPPRShellCacheKey() {
  const source = fs.readFileSync(
    path.join(process.cwd(), "src", "nitro", "universal-build.ts"),
    "utf-8",
  );
  const start = source.indexOf("function getPPRShellCacheKey(url, locale, origin)");
  const end = source.indexOf("function getPPRHeaders(", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return new Function(
    "createFarmCacheKey",
    "normalizeRevalidatePath",
    `${source.slice(start, end)}\nreturn getPPRShellCacheKey;`,
  )(
    (parts: string[]) => JSON.stringify(parts),
    (value: string) => value,
  ) as (url: URL, locale: string, origin: string) => string;
}

const productionSnapshot = {
  ...locales,
  locale: "fr",
  direction: "ltr",
  basePath: "/",
};

describe("production i18n document alternates", () => {
  const html = "<!DOCTYPE html><html><head><title>Pricing</title></head><body></body></html>";
  const request = new Request("http://internal:3000/fr/pricing", {
    headers: { "x-forwarded-host": "app.example.com", "x-forwarded-proto": "https" },
  });

  it("resolves alternates against the request URL without trustProxy", () => {
    const applyFarmI18nDocument = createProductionI18nDocument(false);
    expect(
      alternates(applyFarmI18nDocument(html, "/fr/pricing", productionSnapshot, request, {})),
    ).toEqual({
      en: "http://internal:3000/pricing",
      fr: "http://internal:3000/fr/pricing",
      "x-default": "http://internal:3000/pricing",
    });
  });

  it("resolves alternates against forwarded authority under trustProxy", () => {
    const applyFarmI18nDocument = createProductionI18nDocument(true);
    expect(
      alternates(applyFarmI18nDocument(html, "/fr/pricing", productionSnapshot, request)).fr,
    ).toBe("https://app.example.com/fr/pricing");
  });

  it("prefers the route's metadataBase", () => {
    const applyFarmI18nDocument = createProductionI18nDocument(true);
    expect(
      alternates(
        applyFarmI18nDocument(html, "/fr/pricing", productionSnapshot, request, {
          metadataBase: new URL("https://www.example.com"),
        }),
      ),
    ).toEqual({
      en: "https://www.example.com/pricing",
      fr: "https://www.example.com/fr/pricing",
      "x-default": "https://www.example.com/pricing",
    });
  });

  it("keys cached PPR shells by the origin their alternates resolved against", () => {
    const getPPRShellCacheKey = createProductionPPRShellCacheKey();
    const url = new URL("http://internal:3000/fr/pricing");
    expect(getPPRShellCacheKey(url, "fr", "https://a.example")).not.toBe(
      getPPRShellCacheKey(url, "fr", "https://b.example"),
    );
    expect(getPPRShellCacheKey(url, "fr", "")).toBe(
      JSON.stringify(["ppr", "fr", "/fr/pricing", ""]),
    );
  });
});

const pageModulePath = "/test/src/app/pricing/page.tsx";

function createDevRenderer(
  options: { trustProxy?: boolean; metadata?: Record<string, unknown>; ppr?: boolean } = {},
) {
  const i18n = resolveFarmI18nConfig(
    { ...locales, locales: [...locales.locales] },
    { root: "/test", mode: "development" },
  );
  const pageModule = {
    ...(options.ppr ? { ppr: true } : {}),
    metadata: { title: "Pricing", ...options.metadata },
    default: function PricingPage() {
      return React.createElement("main", null, "pricing");
    },
  };
  const routeManager = {
    getRoutes: () => new Map(),
    getLayouts: () => new Map(),
    getIsolatedClientBoundaryModules: () => new Set(),
    matchMetadataRoute: () => null,
    matchMetadataImage: () => null,
    matchRoute: () => ({
      route: { pattern: "/pricing", modulePath: pageModulePath },
      params: {},
      layouts: [],
    }),
    getMatchingLoading: () => null,
    getMatchingError: () => null,
    getMatchingMetadataImage: () => null,
    getMatchingMetadataRoute: () => null,
    resolveMetadataRoutePath: () => "",
    resolveMetadataImagePath: () => "",
    async loadRouteModule(modulePath: string) {
      if (modulePath !== pageModulePath) throw new Error(`Unknown module ${modulePath}`);
      return pageModule;
    },
    async loadLayoutModule(modulePath: string) {
      throw new Error(`Unknown layout ${modulePath}`);
    },
    generateClientManifest: () => ({
      routes: [
        {
          pattern: "/pricing",
          modulePath: "/src/app/pricing/page.tsx",
          shouldHydrate: false,
          isClientComponent: false,
          segments: [{ segment: "pricing", isDynamic: false }],
        },
      ],
      layouts: [],
    }),
  };
  return new ServerRenderer(
    {
      root: "/test",
      srcDir: "src",
      outDir: "dist",
      basePath: "/",
      renderer: REACT_RENDERER,
      integrations: {},
      middleware: {},
      routeRules: {},
      deploymentId: "release-1",
      generateBuildId: () => "release-1",
      server: { trustProxy: options.trustProxy === true },
      experimental: { serverComponents: false, serverActions: false, ppr: options.ppr === true },
      i18n,
    } as any,
    routeManager as any,
    new FarmI18nRuntime(i18n),
  );
}

function createRequest(url: string, headers: FarmRequest["headers"]): FarmRequest {
  return { url, method: "GET", headers } as FarmRequest;
}

function createResponse() {
  const headers = new Map<string, unknown>();
  const response = {
    statusCode: 200,
    body: "",
    headersSent: false,
    writableEnded: false,
    setHeader(key: string, value: unknown) {
      headers.set(key.toLowerCase(), value);
      return this;
    },
    getHeader(key: string) {
      return headers.get(key.toLowerCase());
    },
    removeHeader(key: string) {
      headers.delete(key.toLowerCase());
    },
    write(chunk: unknown, encoding?: unknown, callback?: () => void) {
      this.headersSent = true;
      this.body += ArrayBuffer.isView(chunk)
        ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("utf8")
        : String(chunk ?? "");
      (typeof encoding === "function" ? encoding : callback)?.();
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) this.write(chunk);
      this.writableEnded = true;
      return this;
    },
    flush() {},
    headers,
  };
  return response as unknown as FarmResponse & { body: string; headers: Map<string, unknown> };
}

const forwardedHeaders = {
  host: "internal:3000",
  "x-forwarded-host": "app.example.com",
  "x-forwarded-proto": "https",
};

describe("development renderer hreflang alternates", () => {
  it("resolves alternates against the Host header without trustProxy", async () => {
    const response = createResponse();
    await createDevRenderer().renderPage(createRequest("/fr/pricing", forwardedHeaders), response);

    expect(alternates(response.body)).toEqual({
      en: "http://internal:3000/pricing",
      fr: "http://internal:3000/fr/pricing",
      "x-default": "http://internal:3000/pricing",
    });
  });

  it("resolves alternates against forwarded authority under trustProxy", async () => {
    const response = createResponse();
    await createDevRenderer({ trustProxy: true }).renderPage(
      createRequest("/fr/pricing", forwardedHeaders),
      response,
    );

    expect(alternates(response.body).fr).toBe("https://app.example.com/fr/pricing");
  });

  it("prefers the route's metadataBase", async () => {
    const response = createResponse();
    await createDevRenderer({
      trustProxy: true,
      metadata: { metadataBase: "https://www.example.com" },
    }).renderPage(createRequest("/fr/pricing", forwardedHeaders), response);

    expect(alternates(response.body)).toEqual({
      en: "https://www.example.com/pricing",
      fr: "https://www.example.com/fr/pricing",
      "x-default": "https://www.example.com/pricing",
    });
  });

  it("does not serve one host's cached PPR shell to another host", async () => {
    const renderer = createDevRenderer({ ppr: true });
    const render = async (host: string) => {
      const response = createResponse();
      await renderer.renderPage(createRequest("/fr/pricing?ppr-hosts", { host }), response);
      return response;
    };

    const first = await render("a.example");
    expect(first.headers.get("x-farm-ppr")).toBe("miss");
    await expect
      .poll(async () => (await render("a.example")).headers.get("x-farm-ppr"))
      .toBe("hit");

    const other = await render("b.example");
    expect(other.headers.get("x-farm-ppr")).toBe("miss");
    expect(alternates(other.body).fr).toBe("http://b.example/fr/pricing");
  });
});
