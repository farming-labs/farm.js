// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
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
    expect(resolveFarmLlmsTxtConfig(true)).toEqual({ enabled: true, include: [], exclude: [] });
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
