import { describe, expect, it } from "vitest";
import { createContentRuntime } from "./runtime.js";

const hello = Object.freeze({
  id: "hello",
  data: Object.freeze({ title: "Hello" }),
  body: "Hello",
  filePath: "content/hello.md",
});

describe("content server runtime", () => {
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
