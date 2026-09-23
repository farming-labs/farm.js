import { describe, expect, it } from "vitest";
import { createContentRuntime, decodeContentValue } from "./runtime.js";

const hello = Object.freeze({
  id: "hello",
  data: Object.freeze({ title: "Hello" }),
  body: "Hello",
  bodyAssets: Object.freeze([]),
  filePath: "content/hello.md",
});

describe("content server runtime", () => {
  it("replaces generated asset tokens throughout data and Markdown body strings", () => {
    const token = "__FARM_CONTENT_ASSET_example__";
    const decoded = decodeContentValue(
      [
        "object",
        [
          ["src", token],
          ["body", `![Example](${token})`],
        ],
      ],
      { [token]: "/assets/example-h123.png" },
    );

    expect(decoded).toEqual({
      src: "/assets/example-h123.png",
      body: "![Example](/assets/example-h123.png)",
    });
  });

  it("reads collections and entries without depending on method binding", async () => {
    const runtime = createContentRuntime({ posts: Object.freeze([hello]) });
    const getEntryOrThrow = runtime.getEntryOrThrow;

    await expect(runtime.getCollection("posts")).resolves.toEqual([hello]);
    await expect(runtime.getEntry("posts", "missing")).resolves.toBeUndefined();
    await expect(getEntryOrThrow("posts", "hello")).resolves.toBe(hello);
  });

  it("reports available collections and missing entries", async () => {
    const runtime = createContentRuntime({ posts: [hello] });

    await expect(runtime.getCollection("pages")).rejects.toThrow("Available collections: posts");
    await expect(runtime.getEntryOrThrow("posts", "missing")).rejects.toThrow(
      'Entry "missing" was not found in collection "posts"',
    );
  });
});
