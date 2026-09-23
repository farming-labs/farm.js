import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collection, remote } from "./config.js";
import { loadContentCollections } from "./loader.js";

const roots: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function emptyRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "farm-content-remote-"));
  roots.push(root);
  return root;
}

const postSchema = {
  parse(value: unknown) {
    const data = value as { title?: unknown };
    if (typeof data?.title !== "string" || !data.title) {
      throw new Error("title must be a non-empty string");
    }
    return data as { title: string };
  },
};

const load = (root: string, definition: ReturnType<typeof collection>) =>
  loadContentCollections(root, { posts: definition }, new Set());

describe("remote content sources", () => {
  it("fetches, validates, and sorts documents by ID for a stable module", async () => {
    const root = await emptyRoot();
    const loaded = await load(
      root,
      collection({
        source: remote({
          name: "cms:posts",
          fetch: async () => [
            { id: "zeta", data: { title: "Z" }, body: "two words" },
            { id: "alpha", data: { title: "A" } },
          ],
        }),
        schema: postSchema,
      }),
    );

    const entries = loaded.collections.posts!;
    expect(entries.map((entry) => entry.id)).toEqual(["alpha", "zeta"]);
    expect(entries[0]).toMatchObject({ data: { title: "A" }, body: "", filePath: "cms:posts/alpha" });
    expect(entries[1]).toMatchObject({ body: "two words" });
  });

  it("runs the transform with the same context shape files get", async () => {
    const root = await emptyRoot();
    const loaded = await load(
      root,
      collection({
        source: remote({
          name: "cms:posts",
          fetch: async () => [{ id: "a", data: { title: "A" }, body: "one two three" }],
        }),
        schema: postSchema,
        transform: ({ data, words, id }) => ({ ...data, words, id }),
      }),
    );

    expect(loaded.collections.posts![0]!.data).toMatchObject({ title: "A", words: 3, id: "a" });
  });

  it("names the source and document when the schema rejects", async () => {
    const root = await emptyRoot();
    await expect(
      load(
        root,
        collection({
          source: remote({ name: "cms:posts", fetch: async () => [{ id: "bad", data: {} }] }),
          schema: postSchema,
        }),
      ),
    ).rejects.toThrow(/cms:posts\/bad/);
  });

  it("rejects duplicate document IDs", async () => {
    const root = await emptyRoot();
    await expect(
      load(
        root,
        collection({
          source: remote({
            name: "cms:posts",
            fetch: async () => [
              { id: "same", data: { title: "A" } },
              { id: "same", data: { title: "B" } },
            ],
          }),
          schema: postSchema,
        }),
      ),
    ).rejects.toThrow(/duplicate entry ID "same"/);
  });

  it("rejects documents without an id or object data", async () => {
    const root = await emptyRoot();
    await expect(
      load(
        root,
        collection({
          source: remote({ name: "cms:posts", fetch: async () => [{ id: "", data: { title: "A" } }] }),
          schema: postSchema,
        }),
      ),
    ).rejects.toThrow(/non-empty string id/);
    await expect(
      load(
        root,
        collection({
          source: remote({
            name: "cms:posts",
            fetch: async () => [{ id: "a", data: [] as unknown as Record<string, unknown> }],
          }),
          schema: postSchema,
        }),
      ),
    ).rejects.toThrow(/object `data`/);
  });

  it("wraps a fetch failure with the collection and source names", async () => {
    const root = await emptyRoot();
    await expect(
      load(
        root,
        collection({
          source: remote({
            name: "cms:posts",
            fetch: async () => {
              throw new Error("boom");
            },
          }),
          schema: postSchema,
        }),
      ),
    ).rejects.toThrow(/"posts" failed to fetch from "cms:posts": boom/);
  });

  it("remote() validates its options", () => {
    expect(() => remote({ name: " ", fetch: async () => [] })).toThrow(/non-empty name/);
    expect(() => remote({ name: "x", fetch: undefined as never })).toThrow(/fetch\(\) function/);
    expect(() => remote({ name: "x", fetch: async () => [], refreshInterval: 5 })).toThrow(
      /at least 100/,
    );
  });

  it("collection() rejects typed asset fields on a remote source", () => {
    expect(() =>
      collection({
        source: remote({ name: "cms:posts", fetch: async () => [] }),
        schema: postSchema,
        assets: { cover: { kind: "image" } } as never,
      }),
    ).toThrow(/cannot declare asset fields/);
  });
});
