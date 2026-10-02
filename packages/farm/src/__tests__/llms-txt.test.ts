// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
  createFarmLlmsMarkdownReader,
  renderFarmLlmsFullTxt,
  resolveFarmLlmsTxtConfig,
  serializeFarmLlmsTxt,
} from "../llms-txt";
import { resolveMarkdownConfig } from "../markdown";

const origin = "https://acme.test";

describe("serializeFarmLlmsTxt", () => {
  it("renders the llmstxt.org shape", () => {
    expect(
      serializeFarmLlmsTxt({
        title: "Acme",
        summary: "Billing for small teams.",
        details: "Prices are in USD.\n\nThe API is versioned.",
        sections: [
          {
            title: "Docs",
            links: [
              { title: "Install", url: "https://acme.test/docs/install.md", description: "Setup" },
              { title: "API", url: "https://acme.test/docs/api.md" },
            ],
          },
          {
            title: "Optional",
            links: [{ title: "Changelog", url: "https://acme.test/changelog" }],
          },
        ],
      }),
    ).toBe(
      [
        "# Acme",
        "",
        "> Billing for small teams.",
        "",
        "Prices are in USD.",
        "",
        "The API is versioned.",
        "",
        "## Docs",
        "",
        "- [Install](https://acme.test/docs/install.md): Setup",
        "- [API](https://acme.test/docs/api.md)",
        "",
        "## Optional",
        "",
        "- [Changelog](https://acme.test/changelog)",
        "",
      ].join("\n"),
    );
  });

  it("keeps values from breaking the Markdown structure", () => {
    const text = serializeFarmLlmsTxt({
      title: "Acme\n## injected",
      summary: "one\n\ntwo",
      sections: [
        {
          title: "Pages",
          links: [
            { title: "[draft] notes", url: "https://acme.test/a b(1).md", description: "x\ny" },
          ],
        },
      ],
    });

    expect(text).toContain("# Acme ## injected\n");
    expect(text).toContain("> one two\n");
    expect(text).toContain("- [\\[draft\\] notes](https://acme.test/a%20b%281%29.md): x y\n");
    expect(text.match(/^## /gm)).toHaveLength(1);
  });

  it("serves a returned string as the whole file", () => {
    // llms.ts can write the complete file itself instead of the structured object.
    const text = "# Acme\n\n> Hand-written index.\n\n## Docs\n\n- [API](https://acme.test/api.md)";
    expect(serializeFarmLlmsTxt(text)).toBe(`${text}\n`);
    expect(serializeFarmLlmsTxt(`${text}\n`)).toBe(`${text}\n`);
    expect(() => serializeFarmLlmsTxt("  \n")).toThrow("llms.ts returned an empty llms.txt");
  });

  it("rejects malformed values with the field that is wrong", () => {
    expect(() => serializeFarmLlmsTxt(null)).toThrow(
      "must return llms.txt text, an llms.txt object, or a Response",
    );
    expect(() => serializeFarmLlmsTxt({ title: " " })).toThrow("non-empty title");
    expect(() => serializeFarmLlmsTxt({ title: "A", sections: {} })).toThrow(
      "sections must be an array",
    );
    expect(() => serializeFarmLlmsTxt({ title: "A", sections: [{ title: "Docs" }] })).toThrow(
      'section "Docs" must include a links array',
    );
    expect(() =>
      serializeFarmLlmsTxt({ title: "A", sections: [{ title: "Docs", links: [{ title: "x" }] }] }),
    ).toThrow('section "Docs" link 0 must include a non-empty url');
  });
});

describe("resolveFarmLlmsTxtConfig", () => {
  it("is off unless enabled", () => {
    expect(resolveFarmLlmsTxtConfig(undefined).enabled).toBe(false);
    expect(resolveFarmLlmsTxtConfig(false).enabled).toBe(false);
    expect(resolveFarmLlmsTxtConfig({ enabled: false, title: "Acme" }).enabled).toBe(false);
    expect(resolveFarmLlmsTxtConfig(true)).toEqual({
      enabled: true,
      include: [],
      exclude: [],
      full: true,
    });
    expect(resolveFarmLlmsTxtConfig({ full: false, revalidate: 600 })).toMatchObject({
      enabled: true,
      full: false,
      revalidate: 600,
    });
  });

  it("passes resolved config through unchanged", () => {
    // The renderer receives already-resolved config typed as user config.
    const resolved = resolveFarmLlmsTxtConfig({ title: "Acme", exclude: ["/admin/[...path]"] });
    expect(resolveFarmLlmsTxtConfig(resolved)).toEqual(resolved);
    const disabled = resolveFarmLlmsTxtConfig(false);
    expect(resolveFarmLlmsTxtConfig(disabled as never)).toEqual(disabled);
  });

  it("rejects route patterns that are not paths", () => {
    expect(() => resolveFarmLlmsTxtConfig({ include: "/docs" as never })).toThrow(
      "agent.llmsTxt.include must be an array",
    );
    expect(() => resolveFarmLlmsTxtConfig({ exclude: ["admin"] })).toThrow(
      'agent.llmsTxt.exclude[0] must be a route pattern starting with "/"',
    );
    expect(() => resolveFarmLlmsTxtConfig({ full: "yes" as never })).toThrow(
      "agent.llmsTxt.full must be a boolean",
    );
    expect(() => resolveFarmLlmsTxtConfig({ revalidate: -1 })).toThrow(
      "agent.llmsTxt.revalidate must be a number of seconds",
    );
  });
});

describe("collectFarmLlmsTxtPages", () => {
  const sources = [
    { pattern: "/pricing", metadata: { title: "Pricing", description: "Plans and limits" } },
    { pattern: "/", metadata: { title: { default: "Acme", template: "%s | Acme" } } },
    { pattern: "/blog/[slug]", metadata: { title: "Post" } },
    { pattern: "/docs/getting-started", metadata: { title: { absolute: "Getting started" } } },
    { pattern: "/admin/users" },
  ];

  it("lists static pages in path order, linking to Markdown mirrors", () => {
    expect(
      collectFarmLlmsTxtPages(sources, {
        origin,
        basePath: "",
        markdown: resolveMarkdownConfig(true),
      }),
    ).toEqual([
      { path: "/", title: "Acme", url: "https://acme.test/index.md" },
      { path: "/admin/users", title: "Users", url: "https://acme.test/admin/users.md" },
      {
        path: "/docs/getting-started",
        title: "Getting started",
        url: "https://acme.test/docs/getting-started.md",
      },
      {
        path: "/pricing",
        title: "Pricing",
        url: "https://acme.test/pricing.md",
        description: "Plans and limits",
      },
    ]);
  });

  it("links to the page itself where no mirror is exposed", () => {
    const pages = collectFarmLlmsTxtPages(sources, {
      origin,
      basePath: "/app",
      markdown: resolveMarkdownConfig({ expose: ["/docs/[...slug]"] }),
    });
    expect(pages.map((page) => page.url)).toEqual([
      // applyFarmBasePath maps the home page to "/app/", like every other Farm link.
      "https://acme.test/app/",
      "https://acme.test/app/admin/users",
      "https://acme.test/app/docs/getting-started.md",
      "https://acme.test/app/pricing",
    ]);
    expect(
      collectFarmLlmsTxtPages(sources, {
        origin,
        basePath: "",
        markdown: resolveMarkdownConfig(false),
      })[0].url,
    ).toBe("https://acme.test/");
  });

  it("applies include and exclude route patterns", () => {
    const paths = (options: { include?: string[]; exclude?: string[] }) =>
      collectFarmLlmsTxtPages(sources, { origin, basePath: "", ...options }).map(
        (page) => page.path,
      );

    expect(paths({ exclude: ["/admin/[...path]"] })).toEqual([
      "/",
      "/docs/getting-started",
      "/pricing",
    ]);
    expect(paths({ include: ["/docs/[...slug]", "/pricing"] })).toEqual([
      "/docs/getting-started",
      "/pricing",
    ]);
  });
});

describe("createFarmDefaultLlmsTxt", () => {
  const pages = [
    { path: "/", title: "Home page", url: "https://acme.test/index.md" },
    {
      path: "/pricing",
      title: "Pricing",
      url: "https://acme.test/pricing.md",
      description: "Plans",
    },
  ];

  it("takes the title and summary from config, then the root layout", () => {
    const config = resolveFarmLlmsTxtConfig({ details: "Prices are in USD." });
    expect(
      createFarmDefaultLlmsTxt({
        origin,
        pages,
        config,
        rootMetadata: { title: { default: "Acme" }, description: "Billing for small teams." },
      }),
    ).toEqual({
      title: "Acme",
      summary: "Billing for small teams.",
      details: "Prices are in USD.",
      sections: [
        {
          title: "Pages",
          links: [
            { title: "Home page", url: "https://acme.test/index.md" },
            { title: "Pricing", url: "https://acme.test/pricing.md", description: "Plans" },
          ],
        },
      ],
    });

    expect(
      createFarmDefaultLlmsTxt({
        origin,
        pages,
        config: resolveFarmLlmsTxtConfig({ title: "Acme Inc.", summary: "Override." }),
        rootMetadata: { title: "Acme", description: "Root." },
      }),
    ).toMatchObject({ title: "Acme Inc.", summary: "Override." });
  });

  it("falls back to the home page title, then the host", () => {
    const config = resolveFarmLlmsTxtConfig(true);
    expect(createFarmDefaultLlmsTxt({ origin, pages, config }).title).toBe("Home page");
    expect(createFarmDefaultLlmsTxt({ origin, pages: [], config })).toEqual({
      title: "acme.test",
      sections: [],
    });
  });
});

describe("renderFarmLlmsFullTxt", () => {
  const index = {
    title: "Acme",
    summary: "Billing for small teams.",
    sections: [
      {
        title: "Pages",
        links: [
          { title: "Pricing", url: "https://acme.test/pricing.md", description: "Plans" },
          { title: "Account", url: "https://acme.test/account.md" },
        ],
      },
      {
        title: "Optional",
        links: [
          { title: "Status", url: "https://status.example/" },
          { title: "Index", url: "https://acme.test/llms.txt" },
          { title: "Pricing again", url: "https://acme.test/pricing.md" },
        ],
      },
    ],
  };

  it("inlines each same-origin page in the docs-engine layout", async () => {
    const read: string[] = [];
    const text = await renderFarmLlmsFullTxt(index, {
      origin: "https://acme.test",
      async readMarkdown(url) {
        read.push(url);
        return url.endsWith("/pricing.md") ? "# Pricing\n\nPro is $20.\n" : null;
      },
    });

    expect(text).toBe(
      [
        "# Acme",
        "",
        "> Billing for small teams.",
        "",
        "## Pricing",
        "",
        "URL: https://acme.test/pricing.md",
        "",
        "Plans",
        "",
        "# Pricing",
        "",
        "Pro is $20.",
        "",
        "---",
        "",
        "## Account",
        "",
        "URL: https://acme.test/account.md",
        "",
        "---",
        "",
        "## Status",
        "",
        "URL: https://status.example/",
        "",
        "---",
        "",
        "## Index",
        "",
        "URL: https://acme.test/llms.txt",
        "",
      ].join("\n"),
    );
    // Other origins and llms.txt itself are never fetched; duplicate links render once.
    expect(read.sort()).toEqual(["https://acme.test/account.md", "https://acme.test/pricing.md"]);
  });

  it("drops a page's frontmatter so its --- lines cannot pass for page separators", async () => {
    const text = await renderFarmLlmsFullTxt(
      {
        title: "Acme",
        sections: [
          { title: "Pages", links: [{ title: "About", url: "https://acme.test/about.md" }] },
        ],
      },
      {
        origin: "https://acme.test",
        readMarkdown: async () =>
          '---\ntitle: "About"\ndescription: "Who we are"\n---\n\n# About\n\n---\n\nKeep this rule.\n',
      },
    );

    expect(text).toBe(
      "# Acme\n\n## About\n\nURL: https://acme.test/about.md\n\n# About\n\n---\n\nKeep this rule.\n",
    );
  });

  it("serves a string unchanged and bounds concurrent reads", async () => {
    expect(
      await renderFarmLlmsFullTxt("# Hand-written", {
        origin: "https://acme.test",
        readMarkdown: async () => "unused",
      }),
    ).toBe("# Hand-written\n");

    const links = Array.from({ length: 9 }, (_, index) => ({
      title: `Page ${index}`,
      url: `https://acme.test/p${index}.md`,
    }));
    let active = 0;
    let peak = 0;
    await renderFarmLlmsFullTxt(
      { title: "Acme", sections: [{ title: "Pages", links }] },
      {
        origin: "https://acme.test",
        concurrency: 3,
        async readMarkdown() {
          peak = Math.max(peak, ++active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active -= 1;
          return "body";
        },
      },
    );
    expect(peak).toBe(3);
  });
});

describe("createFarmLlmsMarkdownReader", () => {
  it("reads Markdown with a fresh request and skips anything else", async () => {
    const requests: Request[] = [];
    const read = createFarmLlmsMarkdownReader(async (request) => {
      requests.push(request);
      const path = new URL(request.url).pathname;
      if (path === "/public.md") {
        return new Response("# Public", {
          headers: { "content-type": "text/markdown; charset=utf-8" },
        });
      }
      if (path === "/private.md") return new Response("Unauthorized", { status: 401 });
      if (path === "/html")
        return new Response("<p>x</p>", { headers: { "content-type": "text/html" } });
      throw new Error("network down");
    });

    expect(await read("https://acme.test/public.md")).toBe("# Public");
    expect(await read("https://acme.test/private.md")).toBeNull();
    expect(await read("https://acme.test/html")).toBeNull();
    expect(await read("https://acme.test/broken.md")).toBeNull();
    // No cookies or credentials: a page behind auth answers 401 instead of leaking.
    for (const request of requests) {
      expect(request.headers.get("cookie")).toBeNull();
      expect(request.headers.get("authorization")).toBeNull();
      expect(request.headers.get("accept")).toBe("text/markdown");
    }
  });
});
