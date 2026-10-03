import type { StrapiClient } from "@strapi/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createStrapiCollection, type StrapiDocument } from "./query.js";

interface Article extends StrapiDocument {
  title: string;
}

function fakeClient(response: unknown) {
  return {
    collection: vi.fn(() => ({
      find: vi.fn(async () => response),
      findOne: vi.fn(async () => response),
    })),
  } as unknown as StrapiClient;
}

describe("createStrapiCollection", () => {
  it("unwraps and types collection responses", async () => {
    const client = fakeClient({
      data: [
        {
          documentId: "article-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          title: "Farm",
        },
      ],
      meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 } },
    });
    const articles = createStrapiCollection<Article>(client, "articles");

    const result = await articles.find({
      fields: ["title"],
      populate: ["cover"],
      filters: { title: { $contains: "Farm" } },
      sort: ["title:asc"],
      pagination: { page: 1, pageSize: 10 },
      locale: "en",
      status: "published",
    });

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Farm");
    expectTypeOf(result).toEqualTypeOf<Article[]>();
  });

  it("unwraps a single document", async () => {
    const client = fakeClient({
      data: {
        documentId: "article-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        title: "Farm",
      },
      meta: {},
    });

    await expect(
      createStrapiCollection<Article>(client, "articles").findOne("article-1"),
    ).resolves.toMatchObject({ title: "Farm" });
  });

  it("rejects path-like resource names", () => {
    expect(() => createStrapiCollection(fakeClient({}), "../admin")).toThrow(/not a path/);
    expect(() => createStrapiCollection(fakeClient({}), "articles/secret")).toThrow(/not a path/);
  });

  it("rejects path-like document ids before calling the provider", async () => {
    const articles = createStrapiCollection(fakeClient({}), "articles");

    await expect(articles.findOne("../admin")).rejects.toThrow(/id, not a path/);
  });

  it("fails clearly when the provider response has no data array", async () => {
    const articles = createStrapiCollection(fakeClient({ data: null }), "articles");

    await expect(articles.find()).rejects.toThrow(/no data array/);
  });

  it("fails clearly when an entry is not a Strapi document", async () => {
    const articles = createStrapiCollection(fakeClient({ data: [{ title: "no id" }] }), "articles");

    await expect(articles.find()).rejects.toThrow(/without a Strapi document/);
  });
});
