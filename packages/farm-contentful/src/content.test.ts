import type { ContentfulClientApi } from "contentful";
import { describe, expect, it, vi } from "vitest";
import { contentfulSource } from "./content.js";

const entry = (id: string, fields: Record<string, unknown>) => ({ sys: { id }, fields });

const stubClient = (pages: Array<{ items: unknown[]; total: number }>) => {
  const getEntries = vi.fn(
    async () => pages[Math.min(getEntries.mock.calls.length - 1, pages.length - 1)],
  );
  return { client: { getEntries } as unknown as ContentfulClientApi<undefined>, getEntries };
};

describe("contentfulSource", () => {
  it("maps entries to remote documents, preferring the slug as the id", async () => {
    const { client, getEntries } = stubClient([
      {
        items: [entry("a1", { slug: "hello", title: "Hello" }), entry("b2", { title: "No slug" })],
        total: 2,
      },
    ]);
    const source = contentfulSource({ client, contentType: "post" });

    const documents = await source.fetch();
    expect(source.kind).toBe("remote");
    expect(source.name).toBe("contentful:post");
    expect(documents.map((doc) => doc.id)).toEqual(["hello", "b2"]);
    expect(documents[0]!.data).toMatchObject({ title: "Hello" });
    expect(getEntries).toHaveBeenCalledWith(
      expect.objectContaining({ content_type: "post", skip: 0, limit: 1000 }),
    );
  });

  it("pages past Contentful's page cap until total is reached", async () => {
    const first = Array.from({ length: 1000 }, (_, index) =>
      entry(`a${index}`, { slug: `a${index}` }),
    );
    const second = Array.from({ length: 200 }, (_, index) =>
      entry(`b${index}`, { slug: `b${index}` }),
    );
    const { client, getEntries } = stubClient([
      { items: first, total: 1200 },
      { items: second, total: 1200 },
    ]);
    const source = contentfulSource({ client, contentType: "post" });

    const documents = await source.fetch();
    expect(documents).toHaveLength(1200);
    expect(getEntries).toHaveBeenCalledTimes(2);
    expect(getEntries.mock.calls[1]![0]).toMatchObject({ skip: 1000 });
  });

  it("limit caps the total entries loaded, matching Contentful's own semantics", async () => {
    const { client, getEntries } = stubClient([
      {
        items: [entry("a", { slug: "a" }), entry("b", { slug: "b" })],
        total: 5,
      },
    ]);
    const source = contentfulSource({ client, contentType: "post", query: { limit: 2 } });

    const documents = await source.fetch();
    expect(documents.map((doc) => doc.id)).toEqual(["a", "b"]);
    expect(getEntries).toHaveBeenCalledTimes(1);
    expect(getEntries.mock.calls[0]![0]).toMatchObject({ limit: 2 });
  });

  it("terminates against a provider that repeats the same page forever", async () => {
    // A broken proxy that ignores skip: without the total-derived bound this
    // looped for the lifetime of the config load.
    const page = { items: [entry("a", { slug: "a" }), entry("b", { slug: "b" })], total: 5 };
    const { client, getEntries } = stubClient([page, page, page, page, page, page, page, page]);
    const source = contentfulSource({ client, contentType: "post" });

    const documents = await source.fetch();
    expect(documents.length).toBeLessThanOrEqual(6);
    expect(getEntries.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("treats a non-positive limit as zero entries without calling the API", async () => {
    const { client, getEntries } = stubClient([{ items: [entry("a", { slug: "a" })], total: 1 }]);
    await expect(
      contentfulSource({ client, contentType: "post", query: { limit: 0 } }).fetch(),
    ).resolves.toEqual([]);
    await expect(
      contentfulSource({ client, contentType: "post", query: { limit: -3 } }).fetch(),
    ).resolves.toEqual([]);
    expect(getEntries).not.toHaveBeenCalled();
  });

  it("forwards query parameters but owns content_type and skip", async () => {
    const { client, getEntries } = stubClient([{ items: [], total: 0 }]);
    const source = contentfulSource({
      client,
      contentType: "post",
      query: { order: ["-sys.createdAt"], content_type: "IGNORED", skip: 99 },
    });

    await source.fetch();
    expect(getEntries.mock.calls[0]![0]).toMatchObject({
      order: ["-sys.createdAt"],
      content_type: "post",
      skip: 0,
    });
  });

  it("extracts a body when asked", async () => {
    const { client } = stubClient([
      { items: [entry("a", { slug: "a", md: "one two" })], total: 1 },
    ]);
    const source = contentfulSource({
      client,
      contentType: "post",
      body: (fields) => fields.md as string,
    });

    const [doc] = await source.fetch();
    expect(doc!.body).toBe("one two");
  });

  it("names the source when an entry has no usable id", async () => {
    const { client } = stubClient([{ items: [entry("x9", { slug: 42 })], total: 1 }]);
    const source = contentfulSource({ client, contentType: "post", id: () => "" });
    await expect(source.fetch()).rejects.toThrow(/could not derive an id for entry "x9"/);
  });

  it("requires a content type and, without a client, resolvable credentials", async () => {
    expect(() => contentfulSource({ contentType: "  " })).toThrow(/requires a `contentType`/);

    const saved = { ...process.env };
    delete process.env.CONTENTFUL_SPACE_ID;
    delete process.env.CONTENTFUL_ACCESS_TOKEN;
    delete process.env.CONTENTFUL_PREVIEW_TOKEN;
    try {
      const source = contentfulSource({ contentType: "post" });
      await expect(source.fetch()).rejects.toThrow(/requires a space and access token/);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  it("is accepted by @farm.js/content's collection() as a real source", async () => {
    const { collection } = await import("@farm.js/content");
    const { client } = stubClient([{ items: [], total: 0 }]);
    const source = contentfulSource({ client, contentType: "post" });
    const schema = { parse: (value: unknown) => value as Record<string, unknown> };

    expect(collection({ source, schema }).source).toBe(source);
  });
});
