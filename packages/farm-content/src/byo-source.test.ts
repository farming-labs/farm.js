import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collection, remote } from "./config.js";
import { loadContentCollections } from "./loader.js";
import { createContentRuntime, registerContentWriteRuntime } from "./runtime.js";

/**
 * The docs' "bring your own CMS" promise, executed: an inline remote()
 * written the way an app author would - plain fetch against the provider's
 * HTTP API, no Farm package, no SDK - must get the same loading, validation,
 * typing pipeline, and collection write surface the official sources get.
 */

const roots: string[] = [];
afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)["__FARM_CONTENT_WRITE_RUNTIME__"];
});

const postSchema = {
  parse(value: unknown) {
    const data = value as { title?: unknown };
    if (typeof data?.title !== "string" || !data.title) throw new Error("title required");
    return data as { title: string };
  },
};

/** A stand-in CMS: a tiny HTTP server's worth of state behind fetch(). */
function stubCms(initial: Array<{ _id: string; slug: string; title: string }>) {
  const documents = new Map(initial.map((doc) => [doc._id, doc]));
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/data/query/")) {
      return new Response(JSON.stringify({ result: [...documents.values()] }));
    }
    if (url.includes("/data/mutate/")) {
      const { mutations } = JSON.parse(String(init?.body));
      const patch = mutations[0].patch;
      const existing = documents.get(patch.id)!;
      const updated = { ...existing, ...patch.set };
      documents.set(patch.id, updated);
      return new Response(JSON.stringify({ results: [{ id: patch.id, document: updated }] }));
    }
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { documents, fetchMock };
}

/** Written exactly like the docs example: inline, HTTP only. */
function inlineSanityStyleSource() {
  const base = "https://demo.api.sanity.io/v2026-03-01";
  return remote({
    name: "sanity:posts",
    fetch: async () => {
      const { result } = await (await fetch(`${base}/data/query/production?query=q`)).json();
      return result.map((doc: { _id: string; slug: string; title: string }) => ({
        id: doc.slug ?? doc._id,
        data: doc,
      }));
    },
    update: async (id, patch) => {
      const response = await fetch(`${base}/data/mutate/production?returnDocuments=true`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer token" },
        body: JSON.stringify({ mutations: [{ patch: { id: `id-${id}`, set: patch.data } }] }),
      });
      const { results } = await response.json();
      return { id, data: results[0].document };
    },
  });
}

describe("bring-your-own source", () => {
  it("loads through the real pipeline with validation and stable ordering", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-byo-"));
    roots.push(root);
    stubCms([
      { _id: "id-b", slug: "beta", title: "B" },
      { _id: "id-a", slug: "alpha", title: "A" },
    ]);

    const loaded = await loadContentCollections(
      root,
      { posts: collection({ source: inlineSanityStyleSource(), schema: postSchema }) },
      new Set(),
    );

    expect(loaded.collections.posts!.map((entry) => entry.id)).toEqual(["alpha", "beta"]);
    expect(loaded.collections.posts![0]!.data).toMatchObject({ title: "A" });
  });

  it("rejects invalid CMS data with the source and document named", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "farm-byo-"));
    roots.push(root);
    stubCms([{ _id: "id-x", slug: "bad", title: "" }]);

    await expect(
      loadContentCollections(
        root,
        { posts: collection({ source: inlineSanityStyleSource(), schema: postSchema }) },
        new Set(),
      ),
    ).rejects.toThrow(/sanity:posts\/bad/);
  });

  it("mutations just work: the collection handle writes through the inline callbacks", async () => {
    const { documents, fetchMock } = stubCms([{ _id: "id-alpha", slug: "alpha", title: "Old" }]);
    const source = inlineSanityStyleSource();
    registerContentWriteRuntime({ posts: { source, schema: postSchema } });
    const { collections } = createContentRuntime({ posts: [] });
    const posts = (collections as Record<string, any>).posts;

    const confirmed = await posts.update("alpha", { data: { title: "New" } });

    expect(confirmed.data).toMatchObject({ title: "New" });
    expect(documents.get("id-alpha")).toMatchObject({ title: "New" }); // the CMS really changed
    const mutateCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/mutate/"))!;
    expect(JSON.parse(String((mutateCall[1] as RequestInit).body))).toMatchObject({
      mutations: [{ patch: { id: "id-alpha", set: { title: "New" } } }],
    });

    // an unimplemented verb still explains itself instead of half-working
    await expect(posts.delete("alpha")).rejects.toThrow(/does not implement delete\(\)/);
  });
});
