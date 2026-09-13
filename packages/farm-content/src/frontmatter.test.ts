import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collection, files } from "./config.js";
import { loadContentCollections } from "./loader.js";

const roots: string[] = [];
const marker = "__farmFrontmatterExecuted";
afterEach(async () => {
  Reflect.deleteProperty(globalThis, marker);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function load(source: string, extension = "md", parse = vi.fn((data: unknown) => data)) {
  const root = await mkdtemp(path.join(tmpdir(), "farm-frontmatter-"));
  roots.push(root);
  await writeFile(path.join(root, `post.${extension}`), source);
  return loadContentCollections(root, {
    posts: collection({ source: files(`post.${extension}`), schema: { parse } }),
  });
}

describe("data-only content frontmatter", () => {
  it.each(["md", "mdx"])(
    "rejects executable language aliases before validation in %s",
    async (extension) => {
      for (const language of ["javascript", "js", "JavaScript", "JS"]) {
        const parse = vi.fn(() => {
          throw new Error("schema must not run");
        });
        const source = `\uFEFF--- ${language}\r\n({ title: "Example", marker: Reflect.set(globalThis, "${marker}", true) })\r\n---\r\nBody`;
        await expect(load(source, extension, parse)).rejects.toThrow(
          "Only YAML and JSON frontmatter are supported",
        );
        expect(Reflect.has(globalThis, marker)).toBe(false);
        expect(parse).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["javascript", "coffee", "python"])(
    "rejects unsupported %s even in an empty block",
    async (language) => {
      await expect(load(`---${language}\n\n---\nBody`)).rejects.toThrow(
        "Only YAML and JSON frontmatter are supported",
      );
    },
  );

  it.each(["", "yaml", "yml", "YAML"])(
    "preserves YAML data, dates, and the body with language %j",
    async (language) => {
      const result = await load(
        `\uFEFF---${language}\r\ntitle: Example\r\npublished: 2026-09-13\r\ntags: [farm, docs]\r\n---\r\n# Body\r\n`,
        "mdx",
      );
      expect(result.collections.posts[0].data).toEqual({
        title: "Example",
        published: new Date("2026-09-13"),
        tags: ["farm", "docs"],
      });
      expect(result.collections.posts[0].body).toBe("# Body\r\n");
    },
  );

  it("preserves JSON frontmatter", async () => {
    const result = await load('---json\n{"title":"Example","count":2}\n---\nBody');
    expect(result.collections.posts[0].data).toEqual({ title: "Example", count: 2 });
    expect(result.collections.posts[0].body).toBe("Body");
  });

  it.each(["Plain body", "----\nNot frontmatter\n----\n"])(
    "preserves bodies without a frontmatter delimiter",
    async (source) => {
      const result = await load(source);
      expect(result.collections.posts[0].body).toBe(source);
    },
  );

  it("keeps parse errors source-aware", async () => {
    await expect(load("---json\n{broken\n---\nBody", "mdx")).rejects.toThrow(
      "Could not parse post.mdx",
    );
  });
});
