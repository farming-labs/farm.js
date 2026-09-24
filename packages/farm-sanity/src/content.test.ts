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
    const client = {
      fetch: vi.fn(async () => [{ _id: "d1", slug: { current: "hello" }, title: "Hi" }]),
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
    return { client: client as unknown as SanityClient, raw: client, set, commit };
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

  it("updates by slug using the id learned from the last fetch", async () => {
    const { client, raw, set } = writeStub();
    const source = sanitySource({ client, query: "q", writeToken: "wt" });

    await source.fetch(); // learns hello -> d1
    const doc = await source.update!("hello", { data: { title: "Patched" } });

    expect(raw.patch).toHaveBeenCalledWith("d1");
    expect(set).toHaveBeenCalledWith({ title: "Patched" });
    expect(doc).toMatchObject({ id: "hello", data: { title: "Patched" } });
  });

  it("falls back to a slug lookup when the id was never fetched", async () => {
    const { client, raw } = writeStub();
    raw.fetch = vi.fn(async () => "resolved-id");
    const source = sanitySource({ client, query: "q", writeToken: "wt" });

    await source.delete!("some-slug");
    expect(raw.fetch).toHaveBeenCalledWith("*[slug.current == $id][0]._id", { id: "some-slug" });
    expect(raw.delete).toHaveBeenCalledWith("resolved-id");
  });

  it("create requires a createType and returns the confirmed document", async () => {
    const { client, raw } = writeStub();
    const source = sanitySource({ client, query: "q", writeToken: "wt" });
    await expect(source.create!({ data: { title: "New" } })).rejects.toThrow(/createType/);

    const typed = sanitySource({ client, query: "q", writeToken: "wt", createType: "post" });
    const doc = await typed.create!({ data: { title: "New" } });
    expect(raw.create).toHaveBeenCalledWith({ _type: "post", title: "New" });
    expect(doc).toMatchObject({ id: "made-slug" });
  });
});
