// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveDocsConfig } from "../config";
import { createDocsAPI, createFarmDocsHandler } from "../docs";

describe("createFarmDocsHandler", () => {
  async function createDocsFixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-handler-"));
    const docsDir = path.join(root, "src", "app", "docs");
    await fs.mkdir(path.join(docsDir, "guide"), { recursive: true });
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
    await fs.writeFile(path.join(docsDir, "guide", "page.md"), ["# Guide", "", "Use `farm dev` to start."].join("\n"));
    const docs = await resolveDocsConfig({ entry: "/docs" }, { root, srcDir: "src" });
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
    await expect(response?.text()).resolves.toContain("<h1>Farm Docs</h1>");
  });

  it("serves markdown when requested by markdown URL", async () => {
    const { root, docs } = await createDocsFixture();
    const handler = createFarmDocsHandler(docs, { root, srcDir: "src" });

    const response = await handler(new Request("http://farm.test/docs/guide.md"));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toContain("text/markdown");
    await expect(response?.text()).resolves.toContain("Use `farm dev` to start.");
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

  it("creates Next-style GET and POST route handlers for Farm API routes", async () => {
    const root = await createDocsFixture();
    const handlers = createDocsAPI({ rootDir: root, srcDir: "src" });

    expect(Object.keys(handlers).sort()).toEqual(["GET", "POST"]);

    const configResponse = await handlers.GET(new Request("http://farm.test/api/docs?format=config"));
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
    await expect(searchResponse.json()).resolves.toMatchObject({
      query: "guide",
      results: [expect.objectContaining({ title: "Guide" })],
    });

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
    await expect(skillPathResponse.text()).resolves.toContain("Agent spec JSON: /api/docs/agent/spec");

    const sitemapPathResponse = await handlers.GET(new Request("http://farm.test/api/docs/sitemap.md"));
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
