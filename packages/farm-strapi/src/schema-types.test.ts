import type { StrapiClient } from "@strapi/client";
import { describe, expectTypeOf, it, vi } from "vitest";
import { createStrapiCollection } from "./query.js";
import type {
  StrapiContentTypeDefinition,
  StrapiGeneratedDocument,
  StrapiMedia,
  StrapiRelation,
} from "./schema-types.js";

declare global {
  namespace FarmJS {
    interface StrapiContentTypes {
      articles: StrapiContentTypeDefinition<
        { title: string; slug: string; summary: string | null },
        {
          category: StrapiRelation<"categories">;
          related: StrapiRelation<"articles", true>;
          cover: StrapiMedia;
        }
      >;
      categories: StrapiContentTypeDefinition<{ name: string }>;
    }
  }
}

function fakeClient() {
  return {
    collection: vi.fn(() => ({
      find: vi.fn(async () => ({ data: [], meta: {} })),
      findOne: vi.fn(async () => ({ data: {}, meta: {} })),
    })),
  } as unknown as StrapiClient;
}

describe("generated Strapi query types", () => {
  it("infers selected scalar and populated fields", async () => {
    const articles = createStrapiCollection(fakeClient(), "articles");
    const result = await articles.find({
      fields: ["title", "slug"],
      populate: ["category", "cover"],
    });
    const article = result[0]!;

    expectTypeOf<typeof article.title>().toEqualTypeOf<string>();
    expectTypeOf<typeof article.slug>().toEqualTypeOf<string>();
    expectTypeOf<
      typeof article.category
    >().toEqualTypeOf<StrapiGeneratedDocument<"categories"> | null>();
    expectTypeOf<typeof article.cover>().not.toBeAny();
    expectTypeOf<typeof article>().not.toHaveProperty("summary");
    expectTypeOf<typeof article>().not.toHaveProperty("related");
  });

  it("keeps unpopulated relations out and treats deep population as unvalidated", async () => {
    const articles = createStrapiCollection(fakeClient(), "articles");
    const unpopulated = (await articles.find())[0]!;
    expectTypeOf<typeof unpopulated>().not.toHaveProperty("category");

    const deeplyPopulated = (
      await articles.find({ populate: { category: { populate: ["owner"] } } })
    )[0]!;
    expectTypeOf<typeof deeplyPopulated.category>().toEqualTypeOf<unknown>();

    const deeplyPopulatedByPath = (
      await articles.find({ populate: ["category.owner", "cover"] })
    )[0]!;
    expectTypeOf<typeof deeplyPopulatedByPath.category>().toEqualTypeOf<unknown>();
    expectTypeOf<typeof deeplyPopulatedByPath.cover>().not.toBeAny();

    const selectivelyPopulated = (
      await articles.find({ populate: { category: true, related: false } })
    )[0]!;
    expectTypeOf<
      typeof selectivelyPopulated.category
    >().toEqualTypeOf<StrapiGeneratedDocument<"categories"> | null>();
    expectTypeOf<typeof selectivelyPopulated>().not.toHaveProperty("related");
  });

  it("keeps dynamic field and population selections conservative", async () => {
    const articles = createStrapiCollection(fakeClient(), "articles");
    const fields: ("title" | "slug")[] = Math.random() ? ["title"] : ["slug"];
    const populate: ("category" | "cover")[] = Math.random() ? ["category"] : ["cover"];
    const article = (await articles.find({ fields, populate }))[0]!;

    expectTypeOf<typeof article.title>().toEqualTypeOf<string | undefined>();
    expectTypeOf<typeof article.category>().toEqualTypeOf<
      StrapiGeneratedDocument<"categories"> | null | undefined
    >();
  });
});
