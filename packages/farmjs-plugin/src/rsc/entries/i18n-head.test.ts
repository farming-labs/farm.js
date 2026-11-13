import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderFarmLocaleAlternateLinks,
  resolveFarmI18nConfig,
  resolveFarmWebRequestOrigin,
} from "@farm.js/core/internal/production-runtime";
import type { EntryContext } from "../types.js";
import { generateRscEntry } from "./rsc.js";

const i18n = resolveFarmI18nConfig(
  { locales: ["en", "fr"], defaultLocale: "en" },
  { basePath: "/console" },
);

function entry(overrides: Partial<EntryContext> = {}): string {
  return generateRscEntry({
    srcDir: "src",
    outDir: "dist",
    basePath: "/console",
    actionsEnabled: false,
    serverActions: { allowedOrigins: [], bodySizeLimit: 1000 },
    deploymentId: "i18n-head",
    debug: false,
    i18n,
    i18nCatalogs: { en: {}, fr: {} },
    ...overrides,
  } as EntryContext);
}

/** The generated hreflang renderer, run with core's helpers and a French request snapshot. */
function alternateLinksRenderer(trustProxy: boolean) {
  const source = entry({ server: { trustProxy } });
  const start = source.indexOf("function renderFarmI18nAlternateLinks(");
  const end = source.indexOf("\n}\n", start) + 2;
  const prerenderStart = source.indexOf("function isFarmPrerenderRequest(");
  const prerenderEnd = source.indexOf("\n}\n", prerenderStart) + 2;
  return new Function(
    "getFarmI18nClientSnapshot",
    "renderFarmLocaleAlternateLinks",
    "resolveFarmI18nRequestOrigin",
    `${source.slice(start, end)}\n${source.slice(prerenderStart, prerenderEnd)}\nreturn renderFarmI18nAlternateLinks;`,
  )(
    () => ({ ...i18n, locale: "fr", direction: "ltr" }),
    renderFarmLocaleAlternateLinks,
    resolveFarmWebRequestOrigin,
  ) as (request: Request, pathname: string, metadata: Record<string, unknown>) => string;
}

describe("RSC hreflang alternates", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("are not generated without i18n", () => {
    const source = entry({ i18n: undefined, i18nCatalogs: undefined });
    expect(source).not.toContain("renderFarmLocaleAlternateLinks");
    expect(source).not.toContain("renderFarmI18nAlternateLinks");
  });

  it("name each locale's URL and x-default below the basePath, on the request's origin", () => {
    const render = alternateLinksRenderer(false);
    const links = render(
      new Request("https://farm.test/console/fr/about"),
      "/console/fr/about",
      {},
    );
    expect(links).toBe(
      '<link rel="alternate" hreflang="en" href="https://farm.test/console/about">' +
        '<link rel="alternate" hreflang="fr" href="https://farm.test/console/fr/about">' +
        '<link rel="alternate" hreflang="x-default" href="https://farm.test/console/about">',
    );
  });

  it("prefer an absolute metadataBase and read forwarded hosts only under trustProxy", () => {
    const forwarded = new Request("http://internal:3000/console/fr/about", {
      headers: { "x-forwarded-host": "shop.example", "x-forwarded-proto": "https" },
    });
    expect(alternateLinksRenderer(false)(forwarded, "/console/fr/about", {})).toContain(
      'hreflang="fr" href="http://internal:3000/console/fr/about"',
    );
    expect(alternateLinksRenderer(true)(forwarded, "/console/fr/about", {})).toContain(
      'hreflang="fr" href="https://shop.example/console/fr/about"',
    );
    expect(
      alternateLinksRenderer(true)(forwarded, "/console/fr/about", {
        metadataBase: new URL("https://www.example.com"),
      }),
    ).toContain('hreflang="fr" href="https://www.example.com/console/fr/about"');
  });

  it("name paths only while the build prerenders a page", () => {
    vi.stubEnv("FARM_RSC_PRERENDER", "1");
    const prerender = new Request("http://localhost/console/fr/static", {
      headers: { "x-nitro-prerender": "/console/fr/static" },
    });
    expect(alternateLinksRenderer(false)(prerender, "/console/fr/static", {})).toContain(
      '<link rel="alternate" hreflang="fr" href="/console/fr/static">',
    );
  });
});
