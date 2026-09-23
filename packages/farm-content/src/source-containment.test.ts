import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collection, files } from "./config.js";
import { loadContentCollections } from "./loader.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "farm-content-containment-"));
  roots.push(directory);
  const root = path.join(directory, "app");
  const outside = path.join(directory, "app-other");
  await mkdir(path.join(root, "content"), { recursive: true });
  await mkdir(outside);
  await writeFile(path.join(outside, "post.md"), "---\ntitle: Outside\n---\nPrivate fixture");
  await writeFile(path.join(root, "content", "post.md"), "---\ntitle: Inside\n---\nSafe fixture");
  return { directory, root, outside };
}

describe("content source containment", () => {
  it.each(["content/linked/*.md", "content/linked/post.md"])(
    "rejects outside directory links in %s before validation",
    async (pattern) => {
      const { root, outside } = await fixture();
      await symlink(outside, path.join(root, "content", "linked"), "junction");
      const parse = vi.fn((data: unknown) => data);
      await expect(
        loadContentCollections(root, {
          posts: collection({ source: files(pattern), schema: { parse } }),
        }),
      ).rejects.toThrow("cannot leave the Farm project root");
      expect(parse).not.toHaveBeenCalled();
    },
  );

  it("keeps recursive glob traversal from following outside links", async () => {
    const { root, outside } = await fixture();
    await symlink(outside, path.join(root, "content", "linked"), "junction");
    const result = await loadContentCollections(root, {
      posts: collection({ source: files("content/**/*.md"), schema: { parse: (data) => data } }),
    });
    expect(result.collections.posts.map((entry) => entry.data)).toEqual([{ title: "Inside" }]);
  });

  it("preserves in-root directory links, stable IDs, and both watch paths", async () => {
    const { root } = await fixture();
    await symlink(path.join(root, "content"), path.join(root, "linked"), "junction");
    const result = await loadContentCollections(root, {
      posts: collection({ source: files("linked/*.md"), schema: { parse: (data) => data } }),
    });
    expect(result.collections.posts[0]).toMatchObject({
      id: "post",
      filePath: "linked/post.md",
      data: { title: "Inside" },
    });
    expect(result.sourceFiles.has(path.join(root, "linked", "post.md"))).toBe(true);
    expect(result.sourceFiles.has(await realpath(path.join(root, "content", "post.md")))).toBe(
      true,
    );
  });

  it("allows a symlinked application root", async () => {
    const { directory, root } = await fixture();
    const alias = path.join(directory, "app-alias");
    await symlink(root, alias, "junction");
    const result = await loadContentCollections(alias, {
      posts: collection({ source: files("content/*.md"), schema: { parse: (data) => data } }),
    });
    expect(result.collections.posts[0].data).toEqual({ title: "Inside" });
  });
});
