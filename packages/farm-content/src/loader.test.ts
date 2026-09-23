import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { asset } from "./assets.js";
import { collection, files } from "./config.js";
import { encodeContentValue, loadContentCollections, writeContentServerModule } from "./loader.js";
import { decodeContentValue } from "./runtime.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-content-"));
  roots.push(root);
  await mkdir(path.join(root, "content", "posts", "guides"), { recursive: true });
  await writeFile(
    path.join(root, "content", "posts", "hello.md"),
    "---\ntitle: Hello\npublishedAt: 2026-09-09\ntags:\n  - farm\n---\nBuild typed content with Farm.\n",
  );
  await writeFile(
    path.join(root, "content", "posts", "guides", "index.mdx"),
    "---\ntitle: Guide\npublishedAt: 2026-09-08\ntags: []\n---\n# Start here\n",
  );
  await writeFile(
    path.join(root, "content", "posts", "data.json"),
    JSON.stringify({ title: "Data", publishedAt: "2026-09-07", tags: [] }),
  );
  return root;
}

const postSchema = {
  async parseAsync(value: unknown) {
    const data = value as Record<string, unknown>;
    if (typeof data.title !== "string") {
      throw { issues: [{ path: ["title"], message: "Expected string" }] };
    }
    return {
      title: data.title,
      publishedAt: new Date(String(data.publishedAt)),
      tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
    };
  },
};

describe("content collection loading", () => {
  it("generates identical asset modules from identical checkout layouts", async () => {
    const buildGeneratedModule = async () => {
      const root = await fixtureRoot();
      await writeFile(
        path.join(root, "content", "posts", "hello.md"),
        "---\ntitle: Hello\nhero: ./hero.svg\n---\nHello\n",
      );
      await writeFile(
        path.join(root, "content", "posts", "hero.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"/>',
      );
      const loaded = await loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/hello.md"),
          schema: {
            parse(value: unknown) {
              return { title: String((value as Record<string, unknown>).title) };
            },
          },
          assets: { hero: asset.image() },
        }),
      });
      const output = path.join(root, ".farm", "content", "server.mjs");
      await writeContentServerModule(output, loaded.collections, loaded.assetImports);
      const source = await readFile(output, "utf8");
      expect(source).toContain('from "../../content/posts/hero.svg?url"');
      return source;
    };

    expect(await buildGeneratedModule()).toBe(await buildGeneratedModule());
  });

  it("loads Markdown, MDX, and JSON with stable IDs and transformed data", async () => {
    const root = await fixtureRoot();
    const loaded = await loadContentCollections(root, {
      posts: collection({
        source: files("content/posts/**/*.{md,mdx,json}"),
        schema: postSchema,
        transform: (entry) => ({
          ...entry.data,
          readingMinutes: Math.max(1, Math.ceil(entry.words / 200)),
        }),
      }),
    });

    expect(loaded.collections.posts.map((entry) => entry.id)).toEqual(["data", "guides", "hello"]);
    expect(loaded.collections.posts[2]).toMatchObject({
      id: "hello",
      body: "Build typed content with Farm.\n",
      bodyAssets: [],
      filePath: "content/posts/hello.md",
      data: {
        title: "Hello",
        tags: ["farm"],
        readingMinutes: 1,
      },
    });
    expect(loaded.collections.posts[2].data.publishedAt).toBeInstanceOf(Date);
    expect(Object.isFrozen(loaded.collections.posts[2].data)).toBe(true);
  });

  it("reports the collection, file, path, and schema issue", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "content", "posts", "broken.md"), "---\ntags: []\n---\n");

    await expect(
      loadContentCollections(root, {
        posts: collection({ source: files("content/posts/broken.md"), schema: postSchema }),
      }),
    ).rejects.toThrow(
      'Collection "posts" rejected content/posts/broken.md: title: Expected string',
    );
  });

  it("derives route-safe IDs from the common base of multiple source globs", async () => {
    const root = await fixtureRoot();
    await mkdir(path.join(root, "content", "pages"), { recursive: true });
    await writeFile(
      path.join(root, "content", "pages", "about.md"),
      "---\ntitle: About\npublishedAt: 2026-09-06\ntags: []\n---\nAbout\n",
    );

    const loaded = await loadContentCollections(root, {
      pages: collection({
        source: files(["content/posts/hello.md", "content/pages/about.md"]),
        schema: postSchema,
      }),
    });

    expect(loaded.collections.pages.map((entry) => entry.id)).toEqual([
      "pages/about",
      "posts/hello",
    ]);
  });

  it("rejects an explicit base that does not own a matched file", async () => {
    const root = await fixtureRoot();
    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/hello.md", { base: "content/other" }),
          schema: postSchema,
        }),
      }),
    ).rejects.toThrow("outside the configured content base content/other");
  });

  it("round-trips dates, bigints, undefined, and prototype-like keys safely", () => {
    const value = Object.create(null) as Record<string, unknown>;
    value.__proto__ = { safe: true };
    value.createdAt = new Date("2026-09-09T00:00:00.000Z");
    value.views = 12n;
    value.optional = undefined;
    const decoded = decodeContentValue(encodeContentValue(value));

    expect(Object.getPrototypeOf(decoded)).toBeNull();
    expect(decoded.__proto__).toEqual({ safe: true });
    expect(decoded.createdAt).toEqual(new Date("2026-09-09T00:00:00.000Z"));
    expect(decoded.views).toBe(12n);
    expect("optional" in decoded).toBe(true);
  });

  it("rejects values that would behave differently after serialization", () => {
    const getter = Object.defineProperty({}, "title", {
      enumerable: true,
      get: () => "hidden work",
    });
    const symbolKey = { [Symbol("private")]: "secret" };
    const sparse = Array(2);

    expect(() => encodeContentValue(getter)).toThrow("getters or setters");
    expect(() => encodeContentValue(symbolKey)).toThrow("symbol keys");
    expect(() => encodeContentValue(sparse)).toThrow("sparse arrays");
  });

  it("reports circular transformed values without overflowing the stack", async () => {
    const root = await fixtureRoot();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/hello.md"),
          schema: postSchema,
          transform: () => circular,
        }),
      }),
    ).rejects.toThrow("[farm:content] Content data cannot contain circular references");
  });

  it("writes a normal generated server module only when content changes", async () => {
    const root = await fixtureRoot();
    const output = path.join(root, ".farm", "content", "server.mjs");
    await writeContentServerModule(output, { posts: [] });
    const first = await readFile(output, "utf8");

    expect(first).toContain('from "@farm.js/content/internal/runtime"');
    expect(first).toContain("export const getCollection");
    expect(first).not.toContain("virtual:");
  });

  it("resolves typed frontmatter and Markdown assets into emitted URL imports", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "content", "posts", "hero.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"></svg>\n',
    );
    await writeFile(path.join(root, "content", "posts", "guide.pdf"), "%PDF fixture\n");
    await writeFile(
      path.join(root, "content", "posts", "assets.md"),
      [
        "---",
        "title: Assets",
        "publishedAt: 2026-09-09",
        "tags: []",
        "image: ./hero.svg",
        "downloads:",
        "  - ./guide.pdf",
        "---",
        "![Hero](./hero.svg)",
        "",
        "[Guide](./guide.pdf)",
        "",
        "![Referenced hero][hero]",
        "",
        "[hero]: ./hero.svg",
        "",
        "```md",
        "![Code example](./missing.png)",
        "```",
        "",
        "[Another post](./hello.md)",
        "",
        "![Remote](https://example.com/image.png)",
        "",
      ].join("\n"),
    );

    const loaded = await loadContentCollections(root, {
      posts: collection({
        source: files("content/posts/assets.md"),
        schema: {
          parse(value: unknown) {
            const data = value as Record<string, unknown>;
            expect(data).not.toHaveProperty("image");
            expect(data).not.toHaveProperty("downloads");
            return { title: String(data.title) };
          },
        },
        assets: {
          image: asset.image(),
          downloads: asset.files().default([]),
        },
      }),
    });

    const entry = loaded.collections.posts[0];
    expect(entry.data.image).toMatchObject({
      kind: "image",
      source: "./hero.svg",
      name: "hero.svg",
      type: "image/svg+xml",
      width: 640,
      height: 360,
    });
    expect(entry.data.downloads[0]).toMatchObject({
      kind: "file",
      source: "./guide.pdf",
      name: "guide.pdf",
      type: "application/pdf",
    });
    expect(entry.body).toContain("![Hero](__FARM_CONTENT_ASSET_");
    expect(entry.body).toContain("[Guide](__FARM_CONTENT_ASSET_");
    expect(entry.body).toContain("[hero]: __FARM_CONTENT_ASSET_");
    expect(entry.body).toContain("![Code example](./missing.png)");
    expect(entry.body).toContain("[Another post](./hello.md)");
    expect(entry.body).toContain("![Remote](https://example.com/image.png)");
    expect(entry.bodyAssets).toHaveLength(2);
    expect(loaded.assetImports).toHaveLength(2);
    expect(loaded.sourceFiles).toContain(path.join(root, "content", "posts", "hero.svg"));

    const output = path.join(root, ".farm", "content", "server.mjs");
    await writeContentServerModule(output, loaded.collections, loaded.assetImports);
    const generated = await readFile(output, "utf8");
    expect(generated).toContain("?url");
    expect(generated).toContain("farmContentAsset0");
    expect(generated).toContain("decodeContentValue(");
  });

  it.each(["md", "mdx"])(
    "uses the first duplicate Markdown asset definition in %s",
    async (extension) => {
      const root = await fixtureRoot();
      const directory = path.join(root, "content", "posts");
      await writeFile(path.join(directory, "first.pdf"), "%PDF first\n");
      await writeFile(path.join(directory, "second.pdf"), "%PDF second\n");
      const source = `content/posts/references.${extension}`;
      await writeFile(
        path.join(root, source),
        [
          "---",
          "title: References",
          "publishedAt: 2026-09-09",
          "---",
          "[Download][GUIDE]",
          "",
          "[Guide]: ./first.pdf",
          "[guide]: ./second.pdf",
          "",
        ].join("\n"),
      );

      const loaded = await loadContentCollections(root, {
        posts: collection({ source: files(source), schema: postSchema, assets: true }),
      });
      const entry = loaded.collections.posts[0];
      expect(entry.bodyAssets).toMatchObject([{ kind: "file", source: "./first.pdf" }]);
      expect(entry.bodyAssets).toHaveLength(1);
      expect(entry.body).toContain("[Guide]: __FARM_CONTENT_ASSET_");
      expect(entry.body).toContain("[guide]: ./second.pdf");
      expect(loaded.sourceFiles).not.toContain(path.join(directory, "second.pdf"));
      const output = path.join(root, ".farm", "content", "server.mjs");
      await writeContentServerModule(output, loaded.collections, loaded.assetImports);
      const generated = await readFile(output, "utf8");
      expect(generated).toContain('from "../../content/posts/first.pdf?url"');
      expect(generated).not.toContain("second.pdf?url");
    },
  );

  it("ignores missing shadowed image definitions but still validates the first definition", async () => {
    const root = await fixtureRoot();
    const directory = path.join(root, "content", "posts");
    await writeFile(
      path.join(directory, "hero.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24"/>',
    );
    const source = "content/posts/references.md";
    const body = "![Hero][hero]\n\n[hero]: ./hero.svg\n[HERO]: ./missing.svg\n";
    await writeFile(path.join(root, source), `---\ntitle: Images\n---\n${body}`);
    const collections = {
      posts: collection({ source: files(source), schema: postSchema, assets: true }),
    };
    const loaded = await loadContentCollections(root, collections);
    expect(loaded.collections.posts[0].bodyAssets).toMatchObject([
      { kind: "image", source: "./hero.svg", width: 32, height: 24 },
    ]);
    expect(loaded.collections.posts[0].body).toContain("[HERO]: ./missing.svg");
    expect(loaded.sourceFiles).not.toContain(path.join(directory, "missing.svg"));

    await writeFile(
      path.join(root, source),
      "---\ntitle: Images\n---\n![Hero][hero]\n\n[hero]: ./missing.svg\n[HERO]: ./hero.svg\n",
    );
    await expect(loadContentCollections(root, collections)).rejects.toThrow(
      'Asset "./missing.svg" does not exist',
    );
  });

  it("leaves a remote first definition unchanged even when a later duplicate is local", async () => {
    const root = await fixtureRoot();
    const source = "content/posts/references.md";
    const body =
      "[Guide][guide]\n\n[guide]: https://example.com/guide.pdf\n[guide]: ./missing.pdf\n";
    await writeFile(path.join(root, source), `---\ntitle: Remote\n---\n${body}`);
    const loaded = await loadContentCollections(root, {
      posts: collection({ source: files(source), schema: postSchema, assets: true }),
    });
    expect(loaded.collections.posts[0].body).toBe(body);
    expect(loaded.collections.posts[0].bodyAssets).toEqual([]);
    expect(loaded.assetImports.size).toBe(0);
  });

  it("supports optional, defaulted, and nested frontmatter asset declarations", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "content", "posts", "guide.pdf"), "%PDF guide\n");
    await writeFile(
      path.join(root, "content", "posts", "hello.md"),
      [
        "---",
        "title: Hello",
        "resources:",
        "  label: Further reading",
        "  downloads:",
        "    - ./guide.pdf",
        "---",
        "Hello",
        "",
      ].join("\n"),
    );
    const loaded = await loadContentCollections(root, {
      posts: collection({
        source: files("content/posts/hello.md"),
        schema: {
          parse(value: unknown) {
            const data = value as {
              title?: unknown;
              resources?: Record<string, unknown>;
            };
            expect(data.resources).not.toHaveProperty("downloads");
            return {
              title: String(data.title),
              resources: { label: String(data.resources?.label) },
            };
          },
        },
        assets: {
          image: asset.image().optional(),
          resources: { downloads: asset.files().default([]) },
        },
      }),
    });

    expect(loaded.collections.posts[0].data).toMatchObject({
      image: undefined,
      resources: {
        label: "Further reading",
        downloads: [{ kind: "file", source: "./guide.pdf" }],
      },
    });
  });

  it("reports missing body assets at their Markdown source location", async () => {
    const root = await fixtureRoot();
    await writeFile(
      path.join(root, "content", "posts", "missing.md"),
      "---\ntitle: Missing\npublishedAt: 2026-09-09\ntags: []\n---\nText\n\n![Missing](./missing.png)\n",
    );

    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/missing.md"),
          schema: postSchema,
          assets: true,
        }),
      }),
    ).rejects.toThrow('body:3:1: Asset "./missing.png" does not exist');
  });

  it("rejects files masquerading as images and paths outside the project", async () => {
    const root = await fixtureRoot();
    await writeFile(path.join(root, "content", "posts", "fake.png"), "not an image\n");
    await writeFile(
      path.join(root, "content", "posts", "invalid.md"),
      "---\ntitle: Invalid\npublishedAt: 2026-09-09\ntags: []\nimage: ./fake.png\n---\n",
    );

    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/invalid.md"),
          schema: postSchema,
          assets: { image: asset.image() },
        }),
      }),
    ).rejects.toThrow("is not a supported image with intrinsic dimensions");

    await writeFile(
      path.join(root, "content", "posts", "wrong.png"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>\n',
    );
    await writeFile(
      path.join(root, "content", "posts", "invalid.md"),
      "---\ntitle: Invalid\npublishedAt: 2026-09-09\ntags: []\nimage: ./wrong.png\n---\n",
    );
    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/invalid.md"),
          schema: postSchema,
          assets: { image: asset.image() },
        }),
      }),
    ).rejects.toThrow('has extension ".png" but contains a svg image');

    await writeFile(
      path.join(root, "content", "posts", "invalid.md"),
      "---\ntitle: Invalid\npublishedAt: 2026-09-09\ntags: []\nfile: ../../../../outside.pdf\n---\n",
    );
    await expect(
      loadContentCollections(root, {
        posts: collection({
          source: files("content/posts/invalid.md"),
          schema: postSchema,
          assets: { file: asset.file() },
        }),
      }),
    ).rejects.toThrow("cannot leave the Farm project root");
  });
});
