import { describe, expect, it } from "vitest";
import { collection, files } from "./config.js";

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
});
