import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  createFarmMarkdownRouteModule,
  createFarmMarkdownSourceResponse,
  parseMarkdownFrontmatter,
  resolveMdxConfig,
} from "../app-markdown";

describe("app markdown pages", () => {
  it("parses frontmatter from markdown sources", () => {
    const parsed = parseMarkdownFrontmatter(
      ["---", 'title: "About"', "description: Static content", "---", "# About"].join("\n"),
    );

    expect(parsed.frontmatter).toEqual({
      title: "About",
      description: "Static content",
    });
    expect(parsed.body).toContain("# About");
  });

  it("handles frontmatter without a trailing body", () => {
    const parsed = parseMarkdownFrontmatter(["---", "title: Empty", "---"].join("\n"));

    expect(parsed.frontmatter).toEqual({ title: "Empty" });
    expect(parsed.body).toBe("");
  });

  it("renders MDX with configured components", async () => {
    const mod = createFarmMarkdownRouteModule({
      filePath: "/app/about/page.mdx",
      source: [
        "---",
        "title: About Farm",
        "---",
        "# About Farm",
        "",
        "<Callout>Markdown-first pages</Callout>",
      ].join("\n"),
      components: {
        Callout: (props) => React.createElement("aside", { className: "callout" }, props.children),
      },
      config: resolveMdxConfig({ className: "content" }),
    });

    const element = await (mod.default as any)({});
    const html = renderToStaticMarkup(element);

    expect(mod.metadata).toMatchObject({
      title: "About Farm",
    });
    expect(html).toContain('class="content"');
    expect(html).toContain("<h1>About Farm</h1>");
    expect(html).toContain('<aside class="callout">Markdown-first pages</aside>');
  });

  it("serves raw source at the markdown route", async () => {
    const response = await createFarmMarkdownSourceResponse({
      request: new Request("https://farm.test/about.md"),
      config: resolveMdxConfig(undefined),
      resolveSource(pathname) {
        expect(pathname).toBe("/about");
        return {
          filePath: "/app/about/page.mdx",
          source: "# About\n\nRaw source.",
        };
      },
    });

    expect(response?.headers.get("content-type")).toContain("text/markdown");
    expect(response?.headers.get("x-farm-markdown-route")).toBe("/about");
    await expect(response?.text()).resolves.toBe("# About\n\nRaw source.");
  });

  it("serves raw source through markdown content negotiation", async () => {
    const response = await createFarmMarkdownSourceResponse({
      request: new Request("https://farm.test/", {
        headers: {
          Accept: "text/html, text/markdown;q=0.9",
        },
      }),
      config: resolveMdxConfig(undefined),
      resolveSource(pathname) {
        expect(pathname).toBe("/");
        return {
          filePath: "/app/page.md",
          source: "# Curated home",
        };
      },
    });

    expect(response?.headers.get("content-type")).toContain("text/markdown");
    expect(response?.headers.get("content-location")).toBe("/index.md");
    expect(response?.headers.get("vary")).toBe("Accept");
    await expect(response?.text()).resolves.toBe("# Curated home");
  });

  it("ignores content negotiation when markdown has zero preference", async () => {
    const response = await createFarmMarkdownSourceResponse({
      request: new Request("https://farm.test/about", {
        headers: {
          Accept: "text/markdown;q=0",
        },
      }),
      config: resolveMdxConfig(undefined),
      resolveSource() {
        throw new Error("resolveSource should not be called");
      },
    });

    expect(response).toBeNull();
  });

  it("allows raw markdown routes to be disabled", async () => {
    const response = await createFarmMarkdownSourceResponse({
      request: new Request("https://farm.test/about.md"),
      config: resolveMdxConfig({ markdownRoutes: false }),
      resolveSource() {
        return {
          filePath: "/app/about/page.mdx",
          source: "# About",
        };
      },
    });

    expect(response).toBeNull();
  });
});
