import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { generateStrapiTypes, StrapiTypesStaleError } from "./schema.js";

const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "farm-strapi-types-"));
  fixtureRoots.push(root);
  await writeJson(path.join(root, "src/components/shared/seo.json"), {
    collectionName: "components_shared_seos",
    info: { displayName: "SEO" },
    attributes: {
      title: { type: "string", required: true },
      description: { type: "text" },
    },
  });
  await writeJson(path.join(root, "src/components/content/quote.json"), {
    collectionName: "components_content_quotes",
    info: { displayName: "Quote" },
    attributes: { quote: { type: "text", required: true } },
  });
  await writeJson(path.join(root, "src/api/category/content-types/category/schema.json"), {
    kind: "collectionType",
    collectionName: "categories",
    info: { singularName: "category", pluralName: "categories", displayName: "Category" },
    attributes: { name: { type: "string", required: true } },
  });
  await writeJson(path.join(root, "src/api/article/content-types/article/schema.json"), {
    kind: "collectionType",
    collectionName: "articles",
    info: { singularName: "article", pluralName: "articles", displayName: "Article" },
    attributes: {
      title: { type: "string", required: true },
      rating: { type: "decimal" },
      state: { type: "enumeration", enum: ["draft", "ready"], required: true },
      internal: { type: "string", private: true },
      password: { type: "password" },
      category: {
        type: "relation",
        relation: "manyToOne",
        target: "api::category.category",
      },
      related: {
        type: "relation",
        relation: "manyToMany",
        target: "api::article.article",
      },
      author: {
        type: "relation",
        relation: "manyToOne",
        target: "plugin::users-permissions.user",
      },
      cover: { type: "media", multiple: false },
      seo: { type: "component", component: "shared.seo", repeatable: false },
      blocks: { type: "dynamiczone", components: ["content.quote"] },
    },
  });
  return root;
}

describe("generateStrapiTypes", () => {
  it("generates deterministic content, component, relation, media, and dynamic-zone types", async () => {
    const root = await fixture();
    const outFile = path.join(root, "farm/src/strapi.generated.d.ts");
    const first = await generateStrapiTypes({ strapiRoot: root, outFile });
    const output = await readFile(outFile, "utf8");
    const parsed = ts.createSourceFile(
      outFile,
      output,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    ) as ts.SourceFile & { parseDiagnostics: ts.Diagnostic[] };

    expect(first).toMatchObject({ changed: true, contentTypes: 2, components: 2, outFile });
    expect(parsed.parseDiagnostics).toEqual([]);
    expect(output).toContain('"title": string;');
    expect(output).toContain('"rating": number | null;');
    expect(output).toContain('"state": "draft" | "ready";');
    expect(output).not.toContain("internal");
    expect(output).not.toContain("password");
    expect(output).toContain('"category": StrapiRelation<"categories", false>;');
    expect(output).toContain('"related": StrapiRelation<"articles", true>;');
    expect(output).toContain('"author": StrapiUnknownPopulate<false>;');
    expect(output).toContain('"cover": StrapiMedia<false>;');
    expect(output).toContain('"seo": StrapiComponent<StrapiComponentSharedSeo, false>;');
    expect(output).toContain(
      '"blocks": StrapiDynamicZone<(StrapiComponentContentQuote & { __component: "content.quote" })>;',
    );

    await expect(
      generateStrapiTypes({ strapiRoot: root, outFile, check: true }),
    ).resolves.toMatchObject({ changed: false });
    await expect(generateStrapiTypes({ strapiRoot: root, outFile })).resolves.toMatchObject({
      changed: false,
    });
  });

  it("fails check mode when output is missing or stale", async () => {
    const root = await fixture();
    const outFile = path.join(root, "farm/src/strapi.generated.d.ts");

    await expect(
      generateStrapiTypes({ strapiRoot: root, outFile, check: true }),
    ).rejects.toBeInstanceOf(StrapiTypesStaleError);
    await generateStrapiTypes({ strapiRoot: root, outFile });
    await writeFile(outFile, "stale\n", "utf8");
    await expect(generateStrapiTypes({ strapiRoot: root, outFile, check: true })).rejects.toThrow(
      /stale or missing/,
    );
  });

  it("reports missing component schemas", async () => {
    const root = await fixture();
    const article = path.join(root, "src/api/article/content-types/article/schema.json");
    const schema = JSON.parse(await readFile(article, "utf8"));
    schema.attributes.seo.component = "shared.missing";
    await writeJson(article, schema);

    await expect(
      generateStrapiTypes({ strapiRoot: root, outFile: path.join(root, "types.d.ts") }),
    ).rejects.toThrow(/shared\.missing.*not found/);
  });
});
