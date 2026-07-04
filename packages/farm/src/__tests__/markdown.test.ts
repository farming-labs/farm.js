// @vitest-environment node

import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import {
  createMarkdownMirrorResponse,
  htmlToMarkdown,
  resolveMarkdownConfig,
  resolveMarkdownMirrorTarget,
} from "../markdown";

describe("resolveMarkdownConfig", () => {
  it("keeps markdown mirrors disabled by default", () => {
    expect(resolveMarkdownConfig(undefined)).toMatchObject({
      enabled: false,
      expose: [],
      cache: false,
      includeMetadata: true,
    });
  });

  it("normalizes exposed routes and aliases routes to expose", () => {
    const config = resolveMarkdownConfig({
      routes: ["/pricing.md", { route: "blog/[slug]", title: "Blog", cache: 60 }],
      cache: 30,
    });

    expect(config).toMatchObject({
      enabled: true,
      expose: [{ route: "/pricing" }, { route: "/blog/[slug]", title: "Blog", cache: 60 }],
      cache: 30,
    });
  });

  it("supports exposing every existing page route", () => {
    expect(resolveMarkdownConfig(true)).toMatchObject({
      enabled: true,
      expose: true,
    });
  });
});

describe("resolveMarkdownMirrorTarget", () => {
  it("maps exposed .md URLs back to their page route", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing", "/blog/[slug]"],
    });

    expect(resolveMarkdownMirrorTarget(config, "/pricing.md")).toMatchObject({
      pathname: "/pricing",
      route: { route: "/pricing" },
    });
    expect(resolveMarkdownMirrorTarget(config, "/blog/farm.md")).toMatchObject({
      pathname: "/blog/farm",
      route: { route: "/blog/[slug]" },
    });
  });

  it("ignores routes that are not exposed", () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    expect(resolveMarkdownMirrorTarget(config, "/secret.md")).toBeNull();
    expect(resolveMarkdownMirrorTarget(config, "/pricing")).toBeNull();
  });
});

describe("createMarkdownMirrorResponse", () => {
  it("renders an exposed page as markdown", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
      cache: 60,
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md"),
      config,
      routeExists: (pathname) => pathname === "/pricing",
      renderPage: () =>
        new Response(
          [
            "<!doctype html>",
            "<html>",
            "<head><title>Pricing</title></head>",
            "<body>",
            '<div id="root">',
            "<main>",
            "<h1>Pricing</h1>",
            "<p>Simple <strong>plans</strong> for builders.</p>",
            '<a href="/signup">Start now</a>',
            "</main>",
            "</div>",
            "</body>",
            "</html>",
          ].join(""),
          {
            headers: {
              "content-type": "text/html; charset=utf-8",
            },
          },
        ),
    });

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/markdown");
    expect(response?.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=60");
    expect(response?.headers.get("x-farm-markdown-route")).toBe("/pricing");
    const markdown = await response?.text();
    expect(markdown).toContain("# Pricing");
    expect(markdown).toContain("**plans**");
  });

  it("returns null when the target page route does not exist", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md"),
      config,
      routeExists: () => false,
      renderPage: () => {
        throw new Error("renderPage should not be called");
      },
    });

    expect(response).toBeNull();
  });

  it("supports HEAD requests without a response body", async () => {
    const config = resolveMarkdownConfig({
      expose: ["/pricing"],
    });

    const response = await createMarkdownMirrorResponse({
      request: new Request("http://farm.test/pricing.md", { method: "HEAD" }),
      config,
      routeExists: () => true,
      renderPage: () =>
        new Response("<html><body><h1>Pricing</h1></body></html>", {
          headers: {
            "content-type": "text/html",
          },
        }),
    });

    expect(response?.headers.get("content-type")).toContain("text/markdown");
    await expect(response?.text()).resolves.toBe("");
  });
});

describe("htmlToMarkdown", () => {
  it("converts common page HTML into readable markdown", () => {
    expect(
      htmlToMarkdown(
        [
          "<html><head><title>Guide</title></head><body>",
          "<article>",
          "<h2>Install</h2>",
          "<p>Run <code>pnpm add @farmjs/core</code>.</p>",
          '<p><a href="/docs">Read docs</a></p>',
          "</article>",
          "</body></html>",
        ].join(""),
        { sourcePath: "/guide" },
      ),
    ).toContain("[Read docs](/docs)");
  });

  it("prefers page content over layout chrome", () => {
    expect(
      htmlToMarkdown(
        [
          "<html><body>",
          '<div id="root">',
          "<nav>Home About Contact</nav>",
          "<main><h1>About</h1><p>Readable page content.</p></main>",
          "</div>",
          "</body></html>",
        ].join(""),
      ),
    ).not.toContain("Home About Contact");
  });
});

describe("resolveConfig markdown mirrors", () => {
  it("resolves md config from farm.config options", async () => {
    const config = await resolveConfig(
      {
        md: {
          expose: ["/pricing"],
          cache: 60,
        },
      },
      "development",
    );

    expect(config.md).toMatchObject({
      enabled: true,
      expose: [{ route: "/pricing" }],
      cache: 60,
    });
  });
});
