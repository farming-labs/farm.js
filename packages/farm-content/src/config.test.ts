import { describe, expect, it } from "vitest";
import { asset } from "./assets.js";
import { collection, files } from "./config.js";
import type { ContentImageAsset, InferContentCollectionEntry } from "./types.js";

const schema = { parse: (value: unknown) => value as { title: string } };

describe("content config", () => {
  it("normalizes file sources and preserves inferred collection data", () => {
    const source = files(["content/posts/**/*.md", "content/pages/*.yaml"], {
      ignore: "content/posts/drafts/**",
      base: "content",
    });
    const posts = collection({ source, schema });

    expect(source).toEqual({
      kind: "files",
      patterns: ["content/posts/**/*.md", "content/pages/*.yaml"],
      ignore: ["content/posts/drafts/**"],
      base: "content",
    });
    expect(posts.source).toBe(source);
    expect(Object.isFrozen(posts)).toBe(true);
  });

  it("rejects absolute and escaping paths", () => {
    expect(() => files("/tmp/**/*.md")).toThrow("relative to the Farm project root");
    expect(() => files("../content/**/*.md")).toThrow("cannot leave the Farm project root");
  });

  it("requires a supported schema contract", () => {
    expect(() => collection({ source: files("content/*.md"), schema: {} as never })).toThrow(
      "must implement Standard Schema",
    );
  });

  it("normalizes typed asset declarations without treating paths as schema strings", () => {
    const posts = collection({
      source: files("content/*.md"),
      schema,
      assets: {
        image: asset.image().optional(),
        resources: {
          downloads: asset.files().default([]),
        },
      },
    });
    type PostData = InferContentCollectionEntry<typeof posts>["data"];
    const image: PostData["image"] = undefined;
    const expectedImage: ContentImageAsset | undefined = image;

    expect(expectedImage).toBeUndefined();
    expect(posts.assets).not.toBe(true);
    expect(Object.isFrozen(posts.assets)).toBe(true);
    expect(() => asset.image().default([] as never)).toThrow(
      "defaults must be relative path strings",
    );
  });

  it("rejects malformed and circular asset declarations", () => {
    expect(() =>
      collection({
        source: files("content/*.md"),
        schema,
        assets: { image: "image" } as never,
      }),
    ).toThrow("must be an object");

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() =>
      collection({ source: files("content/*.md"), schema, assets: circular as never }),
    ).toThrow("circular references");
  });
});
