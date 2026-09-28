import type { SanityClient } from "@sanity/client";
import { describe, expect, it, vi } from "vitest";
import { sanitySource } from "./content.js";

const stubClient = (documents: unknown) =>
  ({ fetch: vi.fn(async () => documents) }) as unknown as SanityClient;

describe("sanitySource", () => {
  it("maps documents to remote entries, preferring the slug as the id", async () => {
    const client = stubClient([
      { _id: "a1", slug: { current: "hello-world" }, title: "Hello" },
      { _id: "b2", title: "No slug" },
    ]);
    const source = sanitySource({ client, query: "*[_type == 'post']" });

    const documents = await source.fetch();
    expect(source.kind).toBe("remote");
    expect(documents.map((doc) => doc.id)).toEqual(["hello-world", "b2"]);
    expect(documents[0]!.data).toMatchObject({ title: "Hello" });
    expect(client.fetch).toHaveBeenCalledWith("*[_type == 'post']", {});
  });

  it("passes params and extracts a body when asked", async () => {
    const client = stubClient([{ _id: "a", md: "one two" }]);
    const source = sanitySource({
      client,
      query: "q",
      params: { limit: 2 },
      body: (doc) => doc.md as string,
    });

    const [doc] = await source.fetch();
    expect(doc!.body).toBe("one two");
    expect((client.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ limit: 2 });
  });

  it("rejects a query that does not resolve to an array", async () => {
    const source = sanitySource({ client: stubClient({ _id: "one" }), query: "q" });
    await expect(source.fetch()).rejects.toThrow(/must resolve to an array/);
  });

  it("rejects documents it cannot derive an id for", async () => {
    const source = sanitySource({ client: stubClient([{ title: "no id" }]), query: "q" });
    await expect(source.fetch()).rejects.toThrow(/could not derive an id/);
  });

  it("requires a query and, without a client, a resolvable project", async () => {
    expect(() => sanitySource({ query: "  " })).toThrow(/GROQ `query`/);

    const source = sanitySource({ query: "q", name: "sanity:posts" });
    const saved = { ...process.env };
    delete process.env.SANITY_PROJECT_ID;
    delete process.env.SANITY_STUDIO_PROJECT_ID;
    delete process.env.SANITY_DATASET;
    delete process.env.SANITY_STUDIO_DATASET;
    try {
      await expect(source.fetch()).rejects.toThrow(/requires a project id and dataset/);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("is accepted by @farm.js/content's collection() as a real source", async () => {
    const { collection } = await import("@farm.js/content");
    const source = sanitySource({ client: stubClient([]), query: "q" });
    const schema = { parse: (value: unknown) => value as Record<string, unknown> };

    expect(() => collection({ source, schema })).not.toThrow();
    expect(collection({ source, schema }).source).toBe(source);
  });

  it("carries the refresh interval through to the source", () => {
    const source = sanitySource({ client: stubClient([]), query: "q", refreshInterval: 30_000 });
    expect(source.refreshInterval).toBe(30_000);
  });
});

describe("sanitySource writes", () => {
  const writeStub = () => {
    const commit = vi.fn(async () => ({ _id: "d1", slug: { current: "hello" }, title: "Patched" }));
    const set = vi.fn(() => ({ commit }));
    const patch = vi.fn(() => ({ set }));
    const lookups: Array<{ query: string; params: unknown }> = [];
    const client = {
      // The write path resolves a target by running the collection's own read
      // query, so the stub answers with documents. Tests override `documents`
      // to steer what the collection is considered to contain.
      documents: [{ _id: "d1", _type: "post", slug: { current: "hello" } }] as Record<
        string,
        unknown
      >[],
      fetch: vi.fn(async function (this: void, query: string, params: unknown) {
        lookups.push({ query, params });
        return raw.documents;
      }),
      withConfig: vi.fn(function (this: unknown) {
        return client;
      }),
      create: vi.fn(async (doc: Record<string, unknown>) => ({
        ...doc,
        _id: "made",
        slug: { current: "made-slug" },
      })),
      patch,
      delete: vi.fn(async () => ({})),
    };
    const raw = client;
    return { client: client as unknown as SanityClient, raw, set, commit, lookups };
  };

  it("stays read-only without a write token", () => {
    const { client } = writeStub();
    const saved = process.env.SANITY_API_WRITE_TOKEN;
    delete process.env.SANITY_API_WRITE_TOKEN;
    try {
      const source = sanitySource({ client, query: "q" });
      expect(source.update).toBeUndefined();
      expect(source.create).toBeUndefined();
      expect(source.delete).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.SANITY_API_WRITE_TOKEN = saved;
    }
  });

  it("resolves the document live on every write, so a reassigned slug never hits the old document", async () => {
    const { client, raw, set } = writeStub();
    const source = sanitySource({ client, query: "q", writeToken: "wt" });

    await source.update!("hello", { data: { title: "Patched" } });
    expect(raw.patch).toHaveBeenCalledWith("d1");
    expect(set).toHaveBeenCalledWith({ title: "Patched" });

    // An editor reassigns the slug between writes: the next write must follow
    // the live mapping, not anything remembered from before.
    raw.documents = [{ _id: "d2", _type: "post", slug: { current: "hello" } }];
    await source.update!("hello", { data: { title: "Again" } });
    expect(raw.patch).toHaveBeenLastCalledWith("d2");
  });

  it("resolves writes through the collection's own read query", async () => {
    const { client, lookups } = writeStub();
    const source = sanitySource({
      client,
      query: '*[_type == "post"]',
      params: { locale: "en" },
      writeToken: "wt",
      createType: "post",
    });

    await source.update!("hello", { data: { title: "x" } });

    // The write is addressed from the same query and params the read path uses,
    // so a write can only ever target a document this collection reads.
    expect(lookups[0]).toMatchObject({
      query: '*[_type == "post"]',
      params: { locale: "en" },
    });
  });

  it("refuses a slug that belongs to a document the collection does not read", async () => {
    const { client, raw } = writeStub();
    // A `page` and a `post` share the slug "about". The collection reads posts,
    // so deleting "about" must not destroy the page. An unconstrained slug
    // lookup used to resolve whichever document Sanity returned first.
    raw.documents = [{ _id: "post-about", _type: "post", slug: { current: "about" } }];
    const source = sanitySource({ client, query: '*[_type == "post"]', writeToken: "wt" });

    await source.delete!("about");
    expect(raw.delete).toHaveBeenCalledWith("post-about");

    // The same collection cannot reach a document outside its query at all.
    raw.documents = [];
    await expect(source.delete!("about")).rejects.toThrow(/could not resolve "about"/);
    expect(raw.delete).toHaveBeenCalledTimes(1);
  });

  it("names the short projection when the query omits _id", async () => {
    const { client, raw } = writeStub();
    // Reads derive an id from the slug alone, so this collection loads fine;
    // the write is the first thing that needs `_id`.
    raw.documents = [{ slug: { current: "hello" } }];
    const source = sanitySource({
      client,
      query: '*[_type == "post"]{ title, slug }',
      writeToken: "wt",
    });

    await expect(source.update!("hello", { data: {} })).rejects.toThrow(
      /without an `_id`.*Add `_id` to the collection query/s,
    );
    expect(raw.patch).not.toHaveBeenCalled();
  });

  it("still addresses a document by its own _id", async () => {
    const { client, raw } = writeStub();
    // With a custom `id` option the entry id need not be the slug, and callers
    // may address a document by `_id` directly.
    raw.documents = [{ _id: "doc-1", _type: "post", title: "Untitled" }];
    const source = sanitySource({
      client,
      query: "q",
      writeToken: "wt",
      id: (doc) => String(doc.title),
    });

    await source.update!("doc-1", { data: { title: "Named" } });
    expect(raw.patch).toHaveBeenCalledWith("doc-1");
  });

  it("keeps every readable entry writable in a multi-type collection", async () => {
    const { client, raw } = writeStub();
    // createType is only used for `create`. Constraining resolution to it made
    // an entry of any other type in the collection unresolvable, so ordinary
    // updates threw instead of writing.
    raw.documents = [
      { _id: "post-1", _type: "post", slug: { current: "a-post" } },
      { _id: "page-1", _type: "page", slug: { current: "a-page" } },
    ];
    const source = sanitySource({
      client,
      query: '*[_type in ["post", "page"]]',
      writeToken: "wt",
      createType: "post",
    });

    await source.update!("a-page", { data: { title: "Edited" } });
    expect(raw.patch).toHaveBeenCalledWith("page-1");
  });

  it("throws instead of mutating when the id cannot be resolved", async () => {
    const { client, raw } = writeStub();
    raw.documents = [];
    const source = sanitySource({ client, query: "q", writeToken: "wt" });

    await expect(source.update!("ghost", { data: { title: "x" } })).rejects.toThrow(
      /could not resolve "ghost"/,
    );
    await expect(source.delete!("ghost")).rejects.toThrow(/could not resolve/);
    expect(raw.patch).not.toHaveBeenCalled();
    expect(raw.delete).not.toHaveBeenCalled();
  });

  it("create requires a createType and it wins over request-supplied data", async () => {
    const { client, raw } = writeStub();
    const source = sanitySource({ client, query: "q", writeToken: "wt" });
    await expect(source.create!({ data: { title: "New" } })).rejects.toThrow(/createType/);

    const typed = sanitySource({ client, query: "q", writeToken: "wt", createType: "post" });
    const doc = await typed.create!({ data: { title: "New", _type: "adminSettings" } });
    expect(raw.create).toHaveBeenCalledWith({ title: "New", _type: "post" });
    expect(doc).toMatchObject({ id: "made-slug" });
  });

  it("rejects body on writes instead of dropping it silently", async () => {
    const { client } = writeStub();
    const source = sanitySource({ client, query: "q", writeToken: "wt", createType: "post" });
    await expect(source.create!({ data: {}, body: "# md" })).rejects.toThrow(/does not store/);
    await expect(source.update!("hello", { body: "# md" })).rejects.toThrow(/does not store/);
  });
});
