import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("writes a normal generated server module only when content changes", async () => {
    const root = await fixtureRoot();
    const output = path.join(root, ".farm", "content", "server.mjs");
    await writeContentServerModule(output, { posts: [] });
    const first = await readFile(output, "utf8");

    expect(first).toContain('from "@farm.js/content/internal/runtime"');
    expect(first).toContain("export const getCollection");
    expect(first).not.toContain("virtual:");
  });
});
