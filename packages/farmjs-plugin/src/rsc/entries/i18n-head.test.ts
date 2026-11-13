import React from "react";
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

/**
 * The generated layout loop of a page whose root layout renders <html>, run with React and a
 * request snapshot in `locale`.
 */
async function renderRootLayout(
  Layout: unknown,
  { ownsDocument = true, locale = "fr", direction = "ltr" } = {},
): Promise<React.ReactElement> {
  const source = entry();
  const start = source.indexOf("  // Render layouts inside out");
  const end = source.indexOf("  // A root layout that renders <html>", start);
  const helpersStart = source.indexOf("function FarmLocaleDocument(");
  const helpersEnd = source.indexOf("function applyFarmI18nResponse(", helpersStart);
  const rootModule = { default: Layout };
  return new Function(
    "React",
    "getFarmI18nClientSnapshot",
    "LayoutModules",
    "farmDocumentLayoutModules",
    "pageContent",
    "pageProps",
    "h",
    `${source.slice(helpersStart, helpersEnd)}
return (async () => {
${source.slice(start, end)}
return layoutContent;
})();`,
  )(
    React,
    () => ({ ...i18n, locale, direction }),
    [rootModule],
    new Set(ownsDocument ? [rootModule] : []),
    React.createElement("main", null, "page"),
    { params: {} },
    React.createElement,
  );
}

/** Render a server component element the way the RSC renderer does, one level. */
async function renderComponent(element: React.ReactElement): Promise<any> {
  const type = element.type as (props: unknown) => unknown;
  return typeof type === "function" ? await type(element.props) : element;
}

describe("RSC root layouts that render <html> under i18n", () => {
  it("get the request's lang and dir in place of their own", async () => {
    const Layout = ({ children }: { children: React.ReactNode }) =>
      React.createElement("html", { lang: "en" }, React.createElement("body", null, children));
    const html = await renderComponent(
      await renderRootLayout(Layout, { locale: "ar", direction: "rtl" }),
    );
    expect(html.type).toBe("html");
    expect(html.props).toMatchObject({ lang: "ar", dir: "rtl" });
    expect(html.props.children.props.children.props.children).toBe("page");
  });

  it("set them on an async layout's document and on one a sync layout resolves later", async () => {
    const AsyncLayout = async ({ children }: { children: React.ReactNode }) =>
      React.createElement("html", null, React.createElement("body", null, children));
    const asyncHtml = await renderRootLayout(AsyncLayout);
    expect(asyncHtml.type).toBe("html");
    expect(asyncHtml.props).toMatchObject({ lang: "fr", dir: "ltr" });

    const ThenableLayout = ({ children }: { children: React.ReactNode }) =>
      Promise.resolve(
        React.createElement("html", null, React.createElement("body", null, children)),
      );
    const thenableHtml = await renderComponent(await renderRootLayout(ThenableLayout));
    expect(thenableHtml.props).toMatchObject({ lang: "fr", dir: "ltr" });
  });

  it("leave other root layouts, client layouts and non-<html> results as React renders them", async () => {
    const Section = ({ children }: { children: React.ReactNode }) =>
      React.createElement("section", null, children);
    const shell = await renderRootLayout(Section, { ownsDocument: false });
    expect(shell.type).toBe(Section);

    const ClientLayout = Object.assign(() => null, {
      $$typeof: Symbol.for("react.client.reference"),
    });
    expect((await renderRootLayout(ClientLayout)).type).toBe(ClientLayout);

    const fragment = await renderComponent(await renderRootLayout(Section));
    expect(fragment.type).toBe("section");
    expect(fragment.props).not.toHaveProperty("lang");
  });

  it("are rendered as written without i18n", () => {
    const source = entry({ i18n: undefined, i18nCatalogs: undefined });
    expect(source).not.toContain("FarmLocaleDocument");
    expect(source).not.toContain("withFarmDocumentLocale");
  });
});
