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
