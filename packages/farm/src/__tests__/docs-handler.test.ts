// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import {
  createDocsAPI,
  createFarmDocsAPIHandler,
  createFarmDocsHandler,
  isFarmDocsAPIRequest,
} from "../docs";

describe("createFarmDocsHandler", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-handler-"));
    const docsDir = path.join(root, "src", "app", "docs");
    await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
    await fs.mkdir(path.join(docsDir, "integrations", "stripe"), { recursive: true });
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
        "```bash",
        "farm dev",
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
    return { root, docs };
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
    expect(html).toContain('data-docs-theme="farm-docs"');
    expect(html).toContain('id="nd-docs-layout"');
    expect(html).toContain('id="nd-toc"');
    expect(html).toContain('class="fd-toc sticky');
    expect(html).toContain('class="fd-toc-title inline-flex');
    expect(html).toContain("window.__farmDocsRuntime");
    expect(html).toContain("farmdocs:sidebar-scroll");
    expect(html).toContain("window.sessionStorage");
    expect(html).toContain("x-farm-docs-navigate");
    expect(html).toContain("DOMParser");
    expect(html).toContain("history.pushState");
    expect(html).toContain("farmDocsNavigating");
    expect(html).toContain("farmDocsRuntimeId");
    expect(html).toContain("window.__farmDocsPageActionsRuntime");
    expect(html).toContain('data-page-action="copy-markdown"');
    expect(html).toContain('data-markdown-url="/docs.md"');
    expect(html).toContain('data-actions-alignment="right"');
    expect(html).toContain("Copy page");
    expect(html).toContain("Copied page");
    expect(html).toContain("navigator.clipboard");
    expect(html).toContain("try{await navigator.clipboard.writeText(text);return}catch{}");
    expect(html).toContain("4500");
    expect(html).toContain('class="fd-page-meta-item">1 min read</span>');
    expect(html).toContain('class="not-prose fd-page-footer"');
    expect(html).toContain("Last updated at");
    expect(html).toContain(
      ".fd-last-updated-inline, .fd-last-updated-footer { color: var(--color-fd-muted-foreground, hsl(0 0% 55%)); font-family: var(--fd-docs-font-mono);",
    );
    expect(html).toContain("letter-spacing: 0.03em; line-height: 1.5; text-transform: uppercase;");
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
    expect(html).toContain("--fd-sidebar-branch-gap: 8px");
    expect(html).toContain("--fd-sidebar-sub-guide-x: calc(var(--fd-sidebar-link-x) + 7px)");
    expect(html).toContain("--fd-sidebar-sub-link-x: calc(var(--fd-sidebar-sub-guide-x) + 28px)");
    expect(html).toContain("--fd-sidebar-nested-icon-gap: 8px");
    expect(html).toContain(
      ".sidebar-folder-content > a[data-active]::after, .sidebar-subgroup-title::after, .sidebar-subgroup-content a[data-active]::after",
    );
    expect(html).toContain("left: calc(var(--fd-sidebar-guide-x) + var(--fd-sidebar-branch-gap))");
    expect(html).toContain(
      ".sidebar-subgroup-content a[data-active]::after { left: var(--fd-sidebar-sub-guide-x);",
    );
    expect(html).toContain(
      '.sidebar-folder-content > a[data-active="true"]::after, .sidebar-subgroup-content a[data-active="true"]::after',
    );
    expect(html).toContain(
      "height: 2px; background: var(--color-fd-primary, oklch(0.985 0.001 106.423));",
    );
    expect(html).toContain("var(--fd-sidebar-nested-icon-gap)");
    expect(html).toContain(".sidebar-subgroup-title { position: relative;");
    expect(html).toContain("font-size: 13.5px; font-weight: 400;");
    expect(html).toContain(".sidebar-subgroup::before");
    expect(html).not.toContain("data-active-marker");
    expect(html).not.toContain('.sidebar-tree a[data-active="true"]::before');
    expect(html).not.toContain('href="/docs">Farm Docs</a>');
    expect(html).toContain('<p class="page-kicker">DOCUMENTATION / OVERVIEW</p>');
    expect(html).toContain("article#nd-page .page-kicker");
    expect(html).toContain("--fd-docs-font-mono: var(--font-geist-mono");
    expect(html).toContain("text-transform: uppercase");
    expect(html).toContain('id="farm-docs"');
    expect(html).toContain('href="#farm-docs"');
    expect(html).toContain('class="fd-page-nav-card fd-page-nav-next"');
    expect(html).toContain('class="fd-page-nav-description');
    expect(html).toContain('href="/docs/guide"');
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
    expect(html).not.toContain("<p><strong>src/app/dashboard/middleware.ts</strong></p>");
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
    expect(html).toContain('data-active="true" data-toc-item');
    expect(html).toContain(".code-block pre { margin: 0; max-width: 100%;");
    expect(html).toContain("background: var(--fd-code-body-bg);");
    expect(html).toContain(
      ".code-block code { display: block; min-width: max-content; border: 0 !important;",
    );
    expect(html).toContain(
      "#nd-docs-layout figure.shiki.code-block > .code-copy-floating { opacity: 0.72;",
    );
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
      expect.objectContaining({
        query: "guide",
        results: expect.arrayContaining([expect.objectContaining({ title: "Guide" })]),
      }),
    );

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
