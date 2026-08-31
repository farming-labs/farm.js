import { describe, expect, it } from "vitest";
import { asArrayOf, asInteger, asString } from "../query/parsers";
import { createPaginationMeta, loadSearchParams } from "../query/server";

describe("loadSearchParams", () => {
  it("keeps every value of an array-shaped prop", async () => {
    const query = await loadSearchParams(Promise.resolve({ tag: ["react", "vite", "zod"] }), {
      tag: asArrayOf(asString),
    });

    expect(query.tag).toEqual(["react", "vite", "zod"]);
  });

  it("keeps every value of a repeated URLSearchParams key", async () => {
    const query = await loadSearchParams(
      Promise.resolve(new URLSearchParams("tag=react&tag=vite&tag=zod")),
      { tag: asArrayOf(asString) },
    );

    expect(query.tag).toEqual(["react", "vite", "zod"]);
  });

  it("still reads a single value", async () => {
    const query = await loadSearchParams(Promise.resolve({ tag: "react" }), {
      tag: asArrayOf(asString),
    });

    expect(query.tag).toEqual(["react"]);
  });

  it("still reads the comma form", async () => {
    const query = await loadSearchParams(Promise.resolve({ tag: "react,vite,zod" }), {
      tag: asArrayOf(asString),
    });

    expect(query.tag).toEqual(["react", "vite", "zod"]);
  });

  it("leaves a single value with a comma in it alone", async () => {
    const query = await loadSearchParams(Promise.resolve({ q: "hello,world" }), { q: asString });

    expect(query.q).toBe("hello,world");
  });

  it("parses each value of a repeated numeric parameter", async () => {
    const query = await loadSearchParams(Promise.resolve({ id: ["1", "2", "3"] }), {
      id: asArrayOf(asInteger),
    });

    expect(query.id).toEqual([1, 2, 3]);
  });

  it("preserves order", async () => {
    const query = await loadSearchParams(Promise.resolve({ tag: ["c", "a", "b"] }), {
      tag: asArrayOf(asString),
    });

    expect(query.tag).toEqual(["c", "a", "b"]);
  });

  it("falls back to the empty parse for a missing parameter", async () => {
    const query = await loadSearchParams(Promise.resolve({}), {
      tag: asArrayOf(asString),
      name: asString,
    });

    expect(query.tag).toBeNull();
    expect(query.name).toBeNull();
  });

  it("keeps pagination metadata finite and non-negative", async () => {
    await expect(
      createPaginationMeta(Promise.resolve(new URLSearchParams("page=-3")), {
        totalItems: 42,
        itemsPerPage: 10,
      }),
    ).resolves.toMatchObject({
      currentPage: 1,
      totalPages: 5,
      offset: 0,
      limit: 10,
      hasPreviousPage: false,
      hasNextPage: true,
    });

    await expect(
      createPaginationMeta(Promise.resolve(new URLSearchParams("page=not-a-number")), {
        totalItems: 0,
      }),
    ).resolves.toMatchObject({
      currentPage: 1,
      totalPages: 0,
      offset: 0,
      hasPreviousPage: false,
      hasNextPage: false,
    });
  });

  it("rejects invalid pagination configuration", async () => {
    await expect(createPaginationMeta(Promise.resolve({}), { totalItems: -1 })).rejects.toThrow(
      "Pagination totalItems",
    );
    await expect(
      createPaginationMeta(Promise.resolve({}), { totalItems: 10, itemsPerPage: 0 }),
    ).rejects.toThrow("Pagination itemsPerPage");
  });
});
