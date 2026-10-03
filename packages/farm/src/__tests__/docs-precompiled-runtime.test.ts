// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFarmDocsAPIHandler, createFarmDocsHandler } from "../docs";
import { compileFarmDocsManifest } from "../docs/compiler";
import { createFarmDocsPrecompiledRuntime } from "../docs/precompiled-runtime";
import type { FarmDocsResolvedConfig } from "../docs/types";

const roots: string[] = [];

async function createFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "farm-docs-edge-"));
  roots.push(root);
  const contentDir = path.join(root, "src", "app", "docs");
  await fs.mkdir(path.join(contentDir, "guide"), { recursive: true });
  await fs.writeFile(
    path.join(contentDir, "page.md"),
    "---\ntitle: Home\ndescription: Edge docs\n---\n\n# Home\n\nWelcome to Farm Docs.\n",
  );
  await fs.writeFile(
    path.join(contentDir, "guide", "page.md"),
    "---\ntitle: Guide\nsection: Start\n---\n\n# Guide\n\nUse `farm dev` to start.\n",
  );

  const docs: FarmDocsResolvedConfig = {
    enabled: true,
    entry: "/docs",
    contentDir,
    configPath: path.join(root, "docs.config.ts"),
    config: {
      entry: "docs",
      docsPath: "/docs",
      contentDir,
      nav: { title: "Farm Edge Docs" },
      search: true,
    },
  };
  return { root, docs };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("precompiled docs runtime", () => {
  it("matches filesystem-backed pages and discovery responses without build paths", async () => {
    const { root, docs } = await createFixture();
    const manifest = await compileFarmDocsManifest(docs, {
      root,
      srcDir: "src",
      clientEntry: "/farm-client.js",
      fontAssets: [],
      fontStylesheetHref: "/farm-fonts.css",
      globalStylesheetHref: "/assets/globals.css",
    });
    const compiled = createFarmDocsPrecompiledRuntime(manifest);
    const filesystem = createFarmDocsHandler(docs, {
      root,
      srcDir: "src",
      clientEntry: "/farm-client.js",
      fontAssets: [],
      fontStylesheetHref: "/farm-fonts.css",
      globalStylesheetHref: "/assets/globals.css",
    });

    expect(JSON.stringify(manifest)).not.toContain(root);
    expect(JSON.stringify(manifest)).not.toContain(docs.contentDir);

    for (const pathname of [
      "/docs",
      "/docs/guide",
      "/docs/guide.md",
      "/llms.txt",
      "/AGENTS.md",
      "/.well-known/agent.json",
      "/docs/sitemap.md",
    ]) {
      const request = new Request(`https://edge.example${pathname}`);
      const [expected, actual] = await Promise.all([
        filesystem(request.clone()),
        compiled.handleDocsRequest(request),
      ]);
      expect(actual?.status, pathname).toBe(expected?.status);
      expect(actual?.headers.get("content-type"), pathname).toBe(
        expected?.headers.get("content-type"),
      );
      await expect(actual?.text(), pathname).resolves.toBe(await expected?.text());
    }
  });

  it("serves markdown and search through the precompiled API", async () => {
    const { root, docs } = await createFixture();
    const manifest = await compileFarmDocsManifest(docs, {
      root,
      srcDir: "src",
      clientEntry: "/farm-client.js",
      fontAssets: [],
    });
    const compiled = createFarmDocsPrecompiledRuntime(manifest);
    const filesystem = createFarmDocsAPIHandler({ rootDir: root, srcDir: "src", docs });

    for (const target of [
      "/api/docs?query=guide",
      "/api/docs?format=markdown&path=guide",
      "/api/docs/guide.md",
      "/api/docs/agent/spec",
      "/api/docs/sitemap.md",
    ]) {
      const request = new Request(`https://edge.example${target}`);
      const [expected, actual] = await Promise.all([
        filesystem(request.clone()),
        compiled.handleAPIRequest(request),
      ]);
      expect(actual?.status, target).toBe(expected?.status);
      expect(actual?.headers.get("content-type"), target).toBe(
        expected?.headers.get("content-type"),
      );
      const actualBody = await actual?.text();
      const expectedBody = await expected?.text();
      if (target === "/api/docs?query=guide") {
        const omitFilesystemSourceIds = (body: string) =>
          JSON.parse(body).map((result: { trust?: { sources?: Array<{ id?: string }> } }) => ({
            ...result,
            trust: result.trust
              ? {
                  ...result.trust,
                  sources: result.trust.sources?.map(({ id: _id, ...source }) => source),
                }
              : undefined,
          }));
        expect(omitFilesystemSourceIds(actualBody || "[]"), target).toEqual(
          omitFilesystemSourceIds(expectedBody || "[]"),
        );
        expect(actualBody, target).not.toContain(root);
      } else if (target === "/api/docs/agent/spec") {
        expect(JSON.parse(actualBody || "null")).toMatchObject({
          name: "Farm Edge Docs",
          routes: { search: "https://edge.example/api/docs?query=<term>" },
        });
      } else {
        expect(actualBody, target).toBe(expectedBody);
      }
    }
  });

  it("serves adapter navigation payloads and a custom API route", async () => {
    const { root, docs } = await createFixture();
    const manifest = await compileFarmDocsManifest(docs, {
      root,
      srcDir: "src",
      clientEntry: "/farm-client.js",
      fontAssets: [],
    });
    manifest.apiPath = "/internal/docs";
    manifest.navigation = {
      "/docs": {
        status: 200,
        statusText: "OK",
        headers: [["content-type", "application/json"]],
        body: JSON.stringify({ data: { title: "Home", url: "/docs" } }),
      },
    };
    const compiled = createFarmDocsPrecompiledRuntime(manifest);

    const navigation = await compiled.handleDocsRequest(
      new Request("https://edge.example/docs", {
        headers: { "x-farm-docs-navigation": "1" },
      }),
    );
    await expect(navigation?.json()).resolves.toEqual({
      data: { title: "Home", url: "/docs" },
    });

    await expect(
      compiled.handleAPIRequest(new Request("https://edge.example/api/docs?query=guide")),
    ).resolves.toBeNull();
    const search = await compiled.handleAPIRequest(
      new Request("https://edge.example/internal/docs?query=guide"),
    );
    expect(search?.status).toBe(200);
    await expect(search?.json()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "Guide" })]),
    );

    const markdown = await compiled.handleAPIRequest(
      new Request("https://edge.example/internal/docs/guide.md"),
    );
    expect(markdown?.status).toBe(200);
    await expect(markdown?.text()).resolves.toContain("# Guide");
  });

  it("rejects function-backed custom search adapters instead of silently changing providers", async () => {
    const { root, docs } = await createFixture();
    docs.config.search = {
      provider: "custom",
      adapter: {
        name: "fixture",
        async search() {
          return [];
        },
      },
    };

    await expect(
      compileFarmDocsManifest(docs, {
        root,
        srcDir: "src",
        clientEntry: "/farm-client.js",
        fontAssets: [],
      }),
    ).rejects.toThrow("cannot serialize a custom docs search adapter");
  });
});
