// @vitest-environment node

import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import {
  createDocsAPI,
  createFarmDocsAPIHandler,
  createFarmDocsHandler,
  getFarmDocsDocumentNavigationMatchers,
  isFarmDocsAPIRequest,
} from "../docs";
import {
  createFarmDocsLastModifiedManifest,
  FARM_DOCS_LAST_MODIFIED_MANIFEST,
} from "../docs/last-modified";
import { resolveFarmDocsFontAssets } from "../docs/fonts";
describe("getFarmDocsDocumentNavigationMatchers", () => {
  it("routes enabled docs trees through document navigation", () => {
    expect(
      getFarmDocsDocumentNavigationMatchers({
        enabled: true,
        entry: "/docs",
        config: { entry: "docs" },
      }),
    ).toEqual(["/docs(.*)"]);

    expect(
      getFarmDocsDocumentNavigationMatchers({
        enabled: true,
        entry: "/",
        config: { entry: "docs" },
      }),
    ).toEqual(["/(.*)"]);
  });

  it("does not register document navigation for disabled docs", () => {
    expect(
      getFarmDocsDocumentNavigationMatchers({
        enabled: false,
        entry: "/docs",
        config: { entry: "docs" },
      }),
    ).toEqual([]);
  });
});

describe("createFarmDocsHandler", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-handler-"));
    const docsDir = path.join(root, "src", "app", "docs");
    const publicDir = path.join(root, "public");
    await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "integrations", "stripe"), { recursive: true });
    await fs.mkdir(publicDir, { recursive: true });
    await fs.writeFile(
      path.join(publicDir, "favicon.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"></svg>',
    );
    await fs.writeFile(
      path.join(docsDir, "page.md"),
      [
        "---",
        "title: Farm Docs",
        "description: Local docs",
        "---",
        "",
        "# Farm Docs",
        "",
        "Welcome to **Farm** docs.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(docsDir, "guide", "page.md"),
      [
        "# Guide",
        "",
        "Use `farm dev` to start.",
        "",
        "## Usage",
        "",
        "**src/app/dashboard/middleware.ts**",
        "",
        "```ts",
        'export const area = "dashboard";',
        "```",
        "",
        '```ts title="hello.ts"',
        'export const hello = "world";',
        "console.log(hello);",
        "```",
        "",
        "**Terminal**",
        "",
        "```bash",
        "farm dev",
        "```",
        "",
        '```tsx title="tsx"',
        "export function Demo() {",
        "  return <p>demo</p>;",
        "}",
        "```",
        "",
        "| Option | Value |",
        "| --- | --- |",
        "| Runtime | Farm |",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(docsDir, "integrations", "stripe", "page.md"),
      [
        "---",
        "title: Stripe Integration",
        "description: Billing docs",
        "section: Integrations",
        "---",
        "",
        "# Stripe Integration",
        "",
        "Create checkout sessions.",
      ].join("\n"),
    );
    const docs = await resolveDocsConfig(
      {
        entry: "/docs",
        config: {
          icons: {
            book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>',
            "brand-stripe":
              '<svg viewBox="0 0 24 24" focusable="false"><path fill="currentColor" stroke="none" d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409"></path></svg>',
            card: '<rect x="2" y="5" width="20" height="14"></rect>',
            plug: '<path d="M12 22v-5"></path>',
            sparkles: '<path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5Z"></path>',
          },
          navigation: {
            sidebar: [
              {
                label: "Start",
                icon: "sparkles",
                children: [
                  { label: "Why?", slug: "", icon: "sparkles" },
                  { label: "Guide", slug: "guide", icon: "book" },
                ],
              },
              {
                label: "Integrations",
                icon: "plug",
                children: [
                  {
                    label: "Payment",
                    icon: "card",
                    children: [
                      { label: "Stripe", slug: "integrations/stripe", icon: "brand-stripe" },
                    ],
                  },
                ],
              },
            ],
          },
          readingTime: {
            enabled: true,
            wordsPerMinute: 200,
          },
          lastUpdated: {
            enabled: true,
            label: "Last updated at",
            position: "footer",
          },
          pageActions: {
            copyMarkdown: {
              enabled: true,
              copiedLabel: "Copied page",
            },
            alignment: "right",
          },
        },
      },
      { root, srcDir: "src" },
    );
    return { root, docs, docsDir };
  }

  it("serves docs markdown files as HTML", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(
      new Request("http://farm.test/docs", {
        headers: { accept: "text/html" },
      }),
    );

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/html");
    const html = await response?.text();
    const htmlText = html || "";
    expect(html).toContain(
      '<link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml">',
    );
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta property="og:title" content="Farm Docs">');
    expect(html).toContain('<meta property="og:description" content="Local docs">');
    expect(html).toContain('<meta property="og:url" content="http://farm.test/docs">');
    expect(html).toMatch(
      /<meta property="og:image" content="http:\/\/farm\.test\/docs\/_social\/index\/opengraph-image\.svg\?v=[a-f0-9]{16}">/,
    );
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(html).toContain('data-docs-theme="farm-docs"');
    expect(html).toContain('id="nd-docs-layout" class="grid"');
    expect(html).not.toContain("data-fd-framework");
    expect(html).toContain('id="nd-toc"');
    expect(html).toContain('class="fd-toc sticky');
    expect(html).toContain('class="fd-toc-title inline-flex');
    expect(html).toContain("window.__farmDocsRuntime");
    expect(html).toContain("farmdocs:sidebar-scroll");
    expect(html).toContain("window.sessionStorage");
    expect(html).toContain("x-farm-docs-navigate");
    expect(html).toContain('cache:"no-store"');
    expect(html).toContain("const getPageKey=");
    expect(html).toContain("renderedArticle===currentArticle");
    expect(html).toContain("DOMParser");
    expect(html).toContain("history.pushState");
    expect(html).toContain("farmDocsNavigating");
    expect(html).toContain("farmDocsRuntimeId");
    expect(html).toContain('class="mobile-topbar"');
    expect(html).toContain("data-sidebar-toggle");
    expect(html).toContain("data-sidebar-backdrop");
    expect(html).toContain('class="fd-docs-search-trigger"');
    expect(html).toContain('data-search-full=""');
    expect(html).toContain('aria-keyshortcuts="Meta+K Control+K"');
    expect(html).not.toContain("fd-docs-search-trigger-label");
    expect(html).toContain("<kbd><span>⌘</span><span>K</span></kbd>");
    expect(html).toContain('id="farm-docs-search-root"');
    expect(html).toContain("data-farm-docs-search-root");
    expect(html).toContain('data-api="/api/docs"');
    expect(html).toContain('aria-label="Search documentation"');
    expect(html).toContain("window.__farmDocsSearchBootstrap");
    expect(htmlText.indexOf("window.__farmDocsSearchBootstrap")).toBeLessThan(
      htmlText.indexOf("<body>"),
    );
    expect(html).toContain('<script type="module" src="/farm-client.js"></script>');
    const topbar = htmlText.slice(
      htmlText.indexOf('<header class="topbar">'),
      htmlText.indexOf("</header>", htmlText.indexOf('<header class="topbar">')),
    );
    const sidebarBrand = htmlText.slice(
      htmlText.indexOf('<div class="sidebar-brand">'),
      htmlText.indexOf("</div>", htmlText.indexOf('<div class="sidebar-brand">')),
    );
    const mobileTopbar = htmlText.slice(
      htmlText.indexOf('<header class="mobile-topbar"'),
      htmlText.indexOf("</header>", htmlText.indexOf('<header class="mobile-topbar"')),
    );
    expect(topbar).toContain('data-search-full=""');
    expect(topbar).not.toContain("<svg");
    expect(topbar).not.toContain(">Farm.js</a>");
    expect(mobileTopbar).toContain("<svg");
    expect(mobileTopbar).not.toContain("mobile-topbar-brand");
    expect(topbar.indexOf('data-search-full=""')).toBeLessThan(topbar.indexOf('href="/llms.txt"'));
    expect(mobileTopbar.indexOf('data-search-full=""')).toBeLessThan(
      mobileTopbar.indexOf('href="/llms.txt"'),
    );
    expect(sidebarBrand).not.toContain('data-search-full=""');
    expect(sidebarBrand).toContain('class="sidebar-brand-logo"');
    expect(sidebarBrand).toContain('<span class="sidebar-brand-title">Docs</span>');
    expect(sidebarBrand).not.toContain("sidebar-brand-suffix");
    expect(html).toContain("font-family: var(--fd-docs-font-mono)");
    expect(html).toContain(".prose ul { list-style: disc outside; }");
    expect(html).toContain(".prose ol { list-style: decimal outside; }");
    expect(html).toContain(".fd-docs-search-trigger { display: inline-flex; width: 56px;");
    expect(html).toContain("#nd-docs-layout .fd-page-nav-title { display: inline-flex;");
    expect(html).toContain("#nd-docs-layout .fd-page-nav-description { display: block;");
    expect(html).not.toContain('id="farm-docs-search-dialog"');
    expect(html).not.toContain("window.__farmDocsSearchRuntime");
    expect(html).toContain("window.__farmDocsHashRuntime");
    expect(html).toContain('window.addEventListener("load",schedule,{once:true})');
    expect(html).toContain('document.getElementById(id)?.scrollIntoView({block:"start"})');
    expect(html).toContain(
      "sidebar.scrollTop+=activeRect.top-sidebarRect.top-(sidebar.clientHeight-activeRect.height)/2",
    );
    expect(html).toContain("initMobileSidebar");
    expect(html).toContain("closeMobileSidebar");
    expect(html).toContain('data-farm-docs-sidebar="open"');
    expect(html).toContain('#nd-docs-layout[data-sidebar-open="true"] aside#nd-sidebar');
    expect(html).toContain(".topbar { display: none !important; }");
    expect(html).toContain("#nd-docs-layout .fd-toc { display: none !important; }");
    expect(html).toContain("window.__farmDocsPageActionsRuntime");
    expect(html).toContain('data-page-action="copy-markdown"');
    expect(html).toContain('data-markdown-url="/docs.md"');
    expect(html).toContain('data-actions-alignment="right"');
    expect(html).toContain("Copy page");
    expect(html).toContain("Copied page");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain("try{await navigator.clipboard.writeText(text);return}catch{}");
    expect(html).toContain("4500");
    expect(html).toContain("--font-geist-mono: ui-monospace, monospace");
    expect(html).not.toContain('font-family: "Geist Sans"');
    expect(html).not.toContain('font-family: "Geist Mono"');
    expect(html).not.toContain("/node_modules/geist/");
    expect(html).not.toContain("/assets/Geist-Variable-CrgPqtmy.woff2");
    expect(html).not.toContain("/assets/GeistMono-Variable-BNLlm6Cd.woff2");
    expect(html).toContain('class="fd-page-meta-item">1 min read</span>');
    expect(html).toContain('class="not-prose fd-page-footer"');
    expect(html).toContain("Last updated at");
    expect(html).toContain(".fd-last-updated-inline,");
    expect(html).toContain(".fd-last-updated-footer {");
    expect(html).toContain("font-family: var(--fd-docs-font-mono);");
    expect(html).not.toContain('href="/sitemap.md"');
    expect(html).not.toContain('href="/AGENTS.md"');
    expect(html).not.toContain(">Markdown</a>");
    expect(html).not.toContain('class="route-pill"');
    expect(html).toContain('data-sidebar-icon="sparkles"');
    expect(html).toContain('data-sidebar-icon="brand-stripe"');
    expect(html).toContain('.sidebar-icon[data-sidebar-icon^="brand-"] svg');
    expect(html).toContain('<span class="sidebar-label-text">Why?</span>');
    expect(html).toContain('data-sidebar-subgroup="payment"');
    expect(html).toContain("--fd-sidebar-line-color");
    expect(html).toContain("--fd-sidebar-branch-gap: 0px");
    expect(html).toContain("--fd-sidebar-sub-guide-x: calc(var(--fd-sidebar-link-x) + 7px)");
    expect(html).toContain("--fd-sidebar-sub-link-x: calc(var(--fd-sidebar-sub-guide-x) + 28px)");
    expect(html).toContain("--fd-sidebar-nested-icon-gap: 0px");
    expect(html).toContain(
      '.sidebar-tree a[data-active="true"], .sidebar-tree a[data-active="true"]:hover { color: var(--color-fd-primary, oklch(0.985 0.001 106.423)) !important; }',
    );
    expect(html).not.toContain(
      '.sidebar-tree a[data-active="true"], .sidebar-tree a[data-active="true"]:hover { color: var(--color-fd-primary, oklch(0.985 0.001 106.423)) !important; font-weight: 600; }',
    );
    expect(html).toContain(
      ".sidebar-folder-content { position: relative; padding: 8px 0; overflow: hidden; }",
    );
    expect(html).toContain(
      '.sidebar-folder-content::before { content: ""; position: absolute; left: var(--fd-sidebar-guide-x); top: 0; bottom: 0;',
    );
    expect(html).toContain(
      ".sidebar-folder-content > a[data-active]::after, .sidebar-subgroup-title::after, .sidebar-subgroup-content a[data-active]::after",
    );
    expect(html).toContain(
      ".sidebar-folder-content > a[data-active]::after { left: calc(var(--fd-sidebar-guide-x) + var(--fd-sidebar-branch-gap));",
    );
    expect(html).toContain(
      ".sidebar-subgroup-title::after { left: calc(var(--fd-sidebar-guide-x) + var(--fd-sidebar-branch-gap)); width: calc(var(--fd-sidebar-sub-guide-x) - var(--fd-sidebar-guide-x) - var(--fd-sidebar-branch-gap));",
    );
    expect(html).toContain(
      ".sidebar-subgroup-content a[data-active]::after { left: var(--fd-sidebar-sub-guide-x);",
    );
    expect(html).toContain(
      "--fd-sidebar-sub-guide-x: calc(var(--fd-sidebar-link-x) + 7px); --fd-sidebar-sub-link-x: calc(var(--fd-sidebar-sub-guide-x) + 28px);",
    );
    expect(html).toContain(
      '.sidebar-folder-content > a[data-active="true"]::after, .sidebar-subgroup-content a[data-active="true"]::after',
    );
    expect(html).toContain(
      '.sidebar-folder-content > a[data-active="true"]::after, .sidebar-subgroup-content a[data-active="true"]::after { background: var(--color-fd-primary, oklch(0.985 0.001 106.423)); }',
    );
    expect(html).not.toContain(
      '.sidebar-folder-content > a[data-active="true"]::after, .sidebar-subgroup-content a[data-active="true"]::after { height: 2px;',
    );
    expect(html).not.toContain(
      "transition: background-color 150ms ease, height 150ms ease, box-shadow 150ms ease;",
    );
    expect(html).toContain("var(--fd-sidebar-nested-icon-gap)");
    expect(html).toContain(".sidebar-subgroup-title { position: relative;");
    expect(html).toContain("font-size: 13.5px; font-weight: 400;");
    expect(html).toContain(".sidebar-subgroup::before");
    expect(html).not.toContain("data-active-marker");
    expect(html).not.toContain('.sidebar-tree a[data-active="true"]::before');
    expect(html).not.toContain('href="/docs">Farm Docs</a>');
    expect(html).not.toContain('class="page-kicker"');
    expect(html).not.toContain("DOCUMENTATION / OVERVIEW");
    expect(html).toContain("article#nd-page .fd-breadcrumb");
    expect(html).toContain(
      "article#nd-page .fd-breadcrumb { display: flex; min-width: 0; align-items: center; gap: 0; margin: 0 0 0.5rem; color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono);",
    );
    expect(html).toContain("--fd-docs-font-mono: var(--fd-layout-font-code, var(--font-geist-mono");
    expect(html).toContain("text-transform: uppercase");
    expect(html).toContain('id="farm-docs"');
    expect(html).toContain('href="#farm-docs"');
    expect(html).toContain('class="fd-page-nav-card fd-page-nav-next"');
    expect(html).toContain('class="fd-page-nav-title fd-page-nav-title-next"');
    expect(html).toContain('<span class="fd-page-nav-description">Next Page</span>');
    expect(html).not.toContain('class="fd-page-nav-label"');
    expect(html).toContain("border-radius: 0 !important;");
    expect(html).toContain("font-size: 0.875rem; font-weight: 500; line-height: 1.5;");
    expect(html).toContain('href="/docs/guide"');
    expect(html).toContain('class="toc-scroll"');
    expect(html).toContain('class="toc-empty"');
  });

  it("renders versioned page-specific docs social images with cache validators", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
    const pageResponse = await handler(new Request("http://farm.test/docs/guide"));
    const html = (await pageResponse?.text()) || "";
    const imageUrl = html.match(/property="og:image" content="([^"]+)"/)?.[1];

    expect(imageUrl).toMatch(
      /^http:\/\/farm\.test\/docs\/_social\/guide\/opengraph-image\.svg\?v=[a-f0-9]{16}$/,
    );

    const imageResponse = await handler(new Request(imageUrl!));
    expect(imageResponse?.status).toBe(200);
    expect(imageResponse?.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(imageResponse?.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(imageResponse?.headers.get("x-content-type-options")).toBe("nosniff");
    const image = await imageResponse?.text();
    expect(image).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(image).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(image).toContain('role="img"');
    expect(image).toContain("Guide — Farm.js documentation");
    expect(image).toContain("PRODUCT ARCHITECTURE");

    const etag = imageResponse?.headers.get("etag");
    const notModified = await handler(
      new Request(imageUrl!, { headers: { "if-none-match": etag! } }),
    );
    expect(notModified?.status).toBe(304);
    expect(await notModified?.text()).toBe("");

    const head = await handler(new Request(imageUrl!, { method: "HEAD" }));
    expect(head?.status).toBe(200);
    expect(head?.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(await head?.text()).toBe("");
  });

  it("supports docs-wide opt-out and page-level social image overrides", async () => {
    const { root, docs, docsDir } = await createDocsFixture();
    await fs.writeFile(
      path.join(docsDir, "guide", "page.md"),
      [
        "---",
        'title: "Guide preview"',
        'description: "A custom social description"',
        'socialTitle: "Guide for teams"',
        'socialImage: "/custom-guide.png"',
        'socialIllustration: "cli"',
        "---",
        "",
        "# Guide",
      ].join("\n"),
    );

    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
    const response = await handler(new Request("https://docs.example.com/docs/guide"));
    const html = await response?.text();
    expect(html).toContain('<meta property="og:title" content="Guide for teams">');
    expect(html).toContain(
      '<meta property="og:image" content="https://docs.example.com/custom-guide.png">',
    );

    const disabledHandler = createFarmDocsHandler(
      { ...docs, config: { ...docs.config, socialImage: false } },
      { root, srcDir: "src" },
    );
    const disabledResponse = await disabledHandler(new Request("http://farm.test/docs"));
    const disabledHtml = await disabledResponse?.text();
    expect(disabledHtml).not.toContain('property="og:image"');
    expect(disabledHtml).not.toContain('name="twitter:card"');
    expect(
      await disabledHandler(new Request("http://farm.test/docs/_social/index/opengraph-image.svg")),
    ).toBeNull();
  });

  it("uses content-fingerprinted Geist assets when the package fonts are available", async () => {
    const { root, docs } = await createDocsFixture();
    const sansPath = path.join(
      root,
      "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
    );
    const monoPath = path.join(
      root,
      "node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2",
    );
    await fs.mkdir(path.dirname(sansPath), { recursive: true });
    await fs.mkdir(path.dirname(monoPath), { recursive: true });
    await fs.writeFile(sansPath, "sans-font-fixture");
    await fs.writeFile(monoPath, "mono-font-fixture");

    const assets = resolveFarmDocsFontAssets(root);
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
    const response = await handler(new Request("http://farm.test/docs"));
    const html = (await response?.text()) || "";

    expect(assets).toHaveLength(2);
    expect(assets.map(({ url }) => url)).toEqual([
      expect.stringMatching(/^\/assets\/fonts\/Geist-Variable-h[a-f0-9]{12}\.woff2$/),
      expect.stringMatching(/^\/assets\/fonts\/GeistMono-Variable-h[a-f0-9]{12}\.woff2$/),
    ]);
    for (const { family, url } of assets) {
      expect(html).toContain(
        `<link rel="preload" href="${url}" as="font" type="font/woff2" crossorigin>`,
      );
      expect(html).toContain(`font-family: "${family}"`);
      expect(html).toContain(`src: url("${url}") format("woff2")`);
    }
    expect(html).toContain('--font-geist-sans: "Geist Sans"');
    expect(html).toContain('--font-geist-mono: "Geist Mono"');
    expect(html).toContain("font-display: block");
    expect(html).toContain("font-synthesis: none");
    expect(response?.headers.get("link")).toBe(
      assets
        .map(({ url }) => `<${url}>; rel=preload; as=font; type=font/woff2; crossorigin`)
        .join(", "),
    );
    expect(html).not.toContain("/node_modules/geist/");
  });

  it("uses resolved layout fonts for standalone docs pages", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, {
      root,
      srcDir: "src",
      fontAssets: [],
      resolveLayoutFonts: async (pathname) => {
        expect(pathname).toBe("/docs");
        return {
          body: {
            className: "font-product-sans",
            variable: "",
            style: { fontFamily: '"Product Sans", system-ui, sans-serif' },
            preloads: [{ href: "/assets/product-sans.woff2", type: "font/woff2" }],
          },
          code: {
            className: "font-product-mono",
            variable: "",
            style: { fontFamily: '"Product Mono", ui-monospace, monospace' },
            preloads: [{ href: "/assets/product-mono.woff2", type: "font/woff2" }],
          },
        };
      },
      fontStylesheetHref: "/farm-fonts.css",
      globalStylesheetHref: "/assets/globals.css",
    });

    const response = await handler(new Request("http://farm.test/docs"));
    const html = (await response?.text()) || "";

    expect(html).toContain('<link rel="stylesheet" href="/farm-fonts.css">');
    expect(html).toContain('<link rel="stylesheet" href="/assets/globals.css">');
    expect(html).toContain('--fd-layout-font-body: "Product Sans", system-ui, sans-serif;');
    expect(html).toContain('--fd-layout-font-code: "Product Mono", ui-monospace, monospace;');
    expect(html).not.toContain('<link rel="preload"');
    expect(html).not.toContain("@font-face");
    expect(response?.headers.get("link")).toBe(
      "</assets/product-sans.woff2>; rel=preload; as=font; type=font/woff2; crossorigin, </assets/product-mono.woff2>; rel=preload; as=font; type=font/woff2; crossorigin",
    );
  });

  it("uses the built-in docs favicon when the project does not provide one", async () => {
    const { root, docs } = await createDocsFixture();
    await fs.unlink(path.join(root, "public", "favicon.svg"));
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(
      new Request("http://farm.test/docs", {
        headers: { accept: "text/html" },
      }),
    );
    const html = await response?.text();

    expect(html).toContain('<link rel="icon" href="data:image/svg+xml,');
    expect(html).toContain('sizes="any" type="image/svg+xml"');
  });

  it("uses an explicitly configured favicon without reading the deployment filesystem", async () => {
    const { root, docs } = await createDocsFixture();
    await fs.unlink(path.join(root, "public", "favicon.svg"));
    docs.config.favicon = "/favicon.svg";
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(
      new Request("http://farm.test/docs", {
        headers: { accept: "text/html" },
      }),
    );
    const html = await response?.text();

    expect(html).toContain(
      '<link rel="icon" href="/favicon.svg" sizes="any" type="image/svg+xml">',
    );
  });

  it("hides the search interface and shortcut when docs search is disabled", async () => {
    const { root, docs } = await createDocsFixture();

    for (const search of [false, { provider: "simple" as const, enabled: false }]) {
      const handler = createFarmDocsHandler(
        {
          ...docs,
          config: {
            ...docs.config,
            search,
          },
        },
        { root, srcDir: "src" },
      );
      const response = await handler(new Request("http://farm.test/docs"));
      const html = await response?.text();

      expect(html).not.toContain('data-search-full=""');
      expect(html).not.toContain('id="farm-docs-search-root"');
      expect(html).not.toContain('aria-keyshortcuts="Meta+K Control+K"');
      expect(html).not.toContain("window.__farmDocsSearchBootstrap");
      expect(html).not.toContain('<script type="module" src="/farm-client.js"></script>');
    }
  });

  it("uses generated metadata instead of deployment file timestamps", async () => {
    const { root, docs, docsDir } = await createDocsFixture();
    const sourcePath = path.join(docsDir, "page.md");
    const copiedTimestamp = new Date("2018-10-20T12:00:00.000Z");
    const lastModified = "2026-07-14T12:00:00.000Z";

    await fs.utimes(sourcePath, copiedTimestamp, copiedTimestamp);
    const manifest = createFarmDocsLastModifiedManifest(docsDir, {
      fallback: "now",
      now: new Date(lastModified),
    });
    await fs.writeFile(
      path.join(docsDir, FARM_DOCS_LAST_MODIFIED_MANIFEST),
      JSON.stringify(manifest),
    );

    expect(manifest.pages["page.md"]).toBe(lastModified);

    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });
    const response = await handler(
      new Request("http://farm.test/docs", {
        headers: { accept: "text/html" },
      }),
    );

    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain(`datetime="${lastModified}"`);
    expect(html).toContain("July 14, 2026");
    expect(html).not.toContain("October 20, 2018");
  });

  it("generates page dates from Git history before file timestamps", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-git-dates-"));
    const docsDir = path.join(root, "docs");
    const sourcePath = path.join(docsDir, "page.md");
    const commitDate = "2026-06-12T09:30:00.000Z";

    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(sourcePath, "# Git-backed date");
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "farm@example.com"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Farm Docs"], {
      cwd: root,
      stdio: "ignore",
    });
    execFileSync("git", ["add", "docs/page.md"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "docs: add page"], {
      cwd: root,
      stdio: "ignore",
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: commitDate,
        GIT_COMMITTER_DATE: commitDate,
      },
    });

    const copiedTimestamp = new Date("2018-10-20T12:00:00.000Z");
    await fs.utimes(sourcePath, copiedTimestamp, copiedTimestamp);

    const manifest = createFarmDocsLastModifiedManifest(docsDir);

    expect(new Date(manifest.pages["page.md"]).toISOString()).toBe(commitDate);
  });

  it("renders docs-style breadcrumbs only for nested docs pages", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const topLevelResponse = await handler(
      new Request("http://farm.test/docs/guide", {
        headers: { accept: "text/html" },
      }),
    );
    await expect(topLevelResponse?.text()).resolves.not.toContain('class="fd-breadcrumb"');

    const nestedResponse = await handler(
      new Request("http://farm.test/docs/integrations/stripe", {
        headers: { accept: "text/html" },
      }),
    );

    const nestedHtml = await nestedResponse?.text();
    expect(nestedHtml).toContain('<nav class="fd-breadcrumb" aria-label="Breadcrumb">');
    expect(nestedHtml).toContain(
      '<a class="fd-breadcrumb-parent fd-breadcrumb-link" href="/docs/integrations">Integrations</a>',
    );
    expect(nestedHtml).toContain('<span class="fd-breadcrumb-current">Stripe</span>');
  });

  it("renders highlighted code blocks without doubled line gaps", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(
      new Request("http://farm.test/docs/guide", {
        headers: { accept: "text/html" },
      }),
    );

    expect(response?.status).toBe(200);
    const html = await response?.text();
    expect(html).toContain('figure class="shiki code-block code-block-framed"');
    expect(html).toContain('figure class="shiki code-block code-block-plain"');
    expect(html).toContain('<span class="code-block-title">src/app/dashboard/middleware.ts</span>');
    expect(html).toContain('<span class="code-block-title">hello.ts</span>');
    expect(html).not.toContain("<p><strong>src/app/dashboard/middleware.ts</strong></p>");
    expect(html).not.toContain('<span class="code-block-title">Terminal</span>');
    expect(html).not.toContain('<span class="code-block-title">tsx</span>');
    expect(html).toContain("sh__token--keyword");
    expect(html).toContain('aria-label="Copy code"');
    expect(html).toContain('class="code-copy-check"');
    expect(html).toContain('data-copied="true"');
    expect(html).toContain("4500");
    expect(html).toContain("querySelector('code').innerText");
    expect(html).toContain(
      'class="fd-table-wrapper table-wrap relative overflow-auto prose-no-margin my-6"',
    );
    expect(html).toContain("data-toc-thumb");
    expect(html).toContain('class="toc-track"');
    expect(html).toContain('class="toc-link" data-active="true" data-toc-item');
    expect(html).toContain('data-active="true" data-toc-item');
    expect(html).toContain(".code-block pre { margin: 0; max-width: 100%;");
    expect(html).toContain("background: var(--fd-code-body-bg);");
    expect(html).toContain(
      ".code-block code { display: block; min-width: max-content; border: 0 !important;",
    );
    expect(html).toContain(
      "#nd-docs-layout figure.shiki.code-block > .code-copy-floating { opacity: 0.72;",
    );
    expect(html).toContain("color-mix(in srgb, var(--color-fd-foreground, #fff) 4%, transparent)");
    expect(html).toContain("@media (max-width: 640px)");
    expect(html).toContain(".code-block-header { min-height: 30px;");
    expect(html).toContain("padding: 12px !important; font-size: 12px;");
    expect(html).toContain(".code-block-plain pre { padding: 16px 44px 16px 14px !important;");
    expect(html).toContain("text-transform: lowercase");
    expect(html).toContain('.code-copy[data-copied="true"] .code-copy-check { display: block; }');
    expect(html).not.toContain('<span class="code-block-title">bash</span>');
    expect(html).not.toContain(">Copy</button>");
    expect(html).not.toContain('</span>\n<span class="sh__line"');
  });

  it("serves markdown when requested by markdown URL", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(new Request("http://farm.test/docs/guide.md"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/markdown");
    await expect(response?.text()).resolves.toContain("Use `farm dev` to start.");
  });

  it("serves public @farming-labs/docs discovery routes", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const llmsResponse = await handler(new Request("http://farm.test/llms.txt"));
    expect(llmsResponse?.status).toBe(200);
    expect(llmsResponse?.headers.get("content-type")).toContain("text/plain");
    await expect(llmsResponse?.text()).resolves.toContain(
      "[Guide](http://farm.test/docs/guide.md)",
    );

    const agentsResponse = await handler(new Request("http://farm.test/AGENTS.md"));
    expect(agentsResponse?.status).toBe(200);
    expect(agentsResponse?.headers.get("content-type")).toContain("text/markdown");
    await expect(agentsResponse?.text()).resolves.toContain("# Agent Instructions");

    const agentSpecResponse = await handler(new Request("http://farm.test/.well-known/agent.json"));
    expect(agentSpecResponse?.status).toBe(200);
    await expect(agentSpecResponse?.json()).resolves.toMatchObject({
      name: "Documentation",
      capabilities: {
        markdownRoutes: true,
      },
    });

    const docsSitemapResponse = await handler(new Request("http://farm.test/docs/sitemap.md"));
    expect(docsSitemapResponse?.status).toBe(200);
    expect(docsSitemapResponse?.headers.get("content-type")).toContain("text/markdown");
    await expect(docsSitemapResponse?.text()).resolves.toContain("[Guide](/docs/guide)");
  });

  it("returns null when docs are disabled", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler({ ...docs, enabled: false }, { root, srcDir: "src" });

    await expect(handler(new Request("http://farm.test/docs"))).resolves.toBeNull();
  });

  it("softens a trailing .js in the sidebar brand title", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(
      {
        ...docs,
        config: {
          ...docs.config,
          nav: { title: "Farm.js" },
        },
      },
      { root, srcDir: "src" },
    );

    const response = await handler(new Request("http://farm.test/docs"));
    const html = await response?.text();

    expect(html).toContain(
      '<span class="sidebar-brand-title">Farm<span class="sidebar-brand-suffix">.js</span></span>',
    );
    expect(html).toContain(".sidebar-brand-suffix { opacity: 0.52; }");
  });
});

describe("createDocsAPI", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-api-"));
    const docsDir = path.join(root, "src", "app", "docs");
    await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
    await fs.writeFile(
      path.join(root, "docs.json"),
      JSON.stringify({
        entry: "docs",
        nav: { title: "Farm API Docs" },
      }),
    );
    await fs.writeFile(path.join(docsDir, "page.md"), "# Farm API Docs\n\nWelcome docs.");
    await fs.writeFile(
      path.join(docsDir, "guide", "page.md"),
      "# Guide\n\nUse `farm dev` to start.",
    );
    return root;
  }

  it("creates a built-in Farm docs API handler for automatic /api/docs routing", async () => {
    const root = await createDocsFixture();
    const handler = createFarmDocsAPIHandler({ rootDir: root, srcDir: "src" });

    expect(isFarmDocsAPIRequest("/api/docs")).toBe(true);
    expect(isFarmDocsAPIRequest("/api/docs/agent/spec")).toBe(true);
    expect(isFarmDocsAPIRequest("/docs")).toBe(false);

    await expect(handler(new Request("http://farm.test/api/other"))).resolves.toBeNull();

    const configResponse = await handler(new Request("http://farm.test/api/docs?format=config"));
    expect(configResponse?.status).toBe(200);
    await expect(configResponse?.json()).resolves.toMatchObject({
      entry: "/docs",
      config: {
        entry: "docs",
      },
    });
  });

  it("creates Next-style GET and POST route handlers for Farm API routes", async () => {
    const root = await createDocsFixture();
    const handlers = createDocsAPI({ rootDir: root, srcDir: "src" });

    expect(Object.keys(handlers).sort()).toEqual(["GET", "POST"]);

    const configResponse = await handlers.GET(
      new Request("http://farm.test/api/docs?format=config"),
    );
    await expect(configResponse.json()).resolves.toMatchObject({
      entry: "/docs",
      config: {
        entry: "docs",
        docsPath: "/docs",
      },
    });

    const markdownResponse = await handlers.GET(
      new Request("http://farm.test/api/docs?format=markdown&path=guide"),
    );
    expect(markdownResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(markdownResponse.text()).resolves.toContain("Use `farm dev` to start.");

    const searchResponse = await handlers.GET(new Request("http://farm.test/api/docs?query=guide"));
    await expect(searchResponse.json()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Guide" })]),
    );

    const emptySearchResponse = await handlers.GET(new Request("http://farm.test/api/docs"));
    await expect(emptySearchResponse.json()).resolves.toEqual([]);

    const pathMarkdownResponse = await handlers.GET(
      new Request("http://farm.test/api/docs/guide.md"),
    );
    expect(pathMarkdownResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(pathMarkdownResponse.text()).resolves.toContain("Use `farm dev` to start.");

    const skillResponse = await handlers.GET(new Request("http://farm.test/api/docs?format=skill"));
    expect(skillResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(skillResponse.text()).resolves.toContain("Search JSON: /api/docs?query=<term>");

    const skillPathResponse = await handlers.GET(new Request("http://farm.test/api/docs/skill.md"));
    expect(skillPathResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(skillPathResponse.text()).resolves.toContain(
      "Agent spec JSON: /api/docs/agent/spec",
    );

    const sitemapPathResponse = await handlers.GET(
      new Request("http://farm.test/api/docs/sitemap.md"),
    );
    expect(sitemapPathResponse.headers.get("content-type")).toContain("text/markdown");
    await expect(sitemapPathResponse.text()).resolves.toContain("[Guide](/docs/guide)");

    const agentResponse = await handlers.GET(new Request("http://farm.test/api/docs/agent/spec"));
    await expect(agentResponse.json()).resolves.toMatchObject({
      name: "Farm API Docs",
      capabilities: {
        search: true,
        markdown: true,
      },
      routes: {
        search: "http://farm.test/api/docs?query=<term>",
      },
    });

    const postResponse = await handlers.POST(
      new Request("http://farm.test/api/docs", { method: "POST" }),
    );
    expect(postResponse.status).toBe(501);
  });

  it("uses Farm's injected docs runtime config when route handlers are zero-config", async () => {
    const root = await createDocsFixture();
    const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
    const previousRuntimeConfig = globalThis.__FARM_DOCS_RUNTIME_CONFIG__;

    try {
      globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = {
        root,
        srcDir: "src",
        docs,
      };

      const handlers = createDocsAPI();
      const response = await handlers.GET(new Request("http://farm.test/api/docs?format=config"));

      await expect(response.json()).resolves.toMatchObject({
        entry: "/docs",
        config: {
          nav: { title: "Farm API Docs" },
        },
      });
    } finally {
      globalThis.__FARM_DOCS_RUNTIME_CONFIG__ = previousRuntimeConfig;
    }
  });
});
