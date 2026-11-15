import { describe, expect, it } from "vitest";
import { createFarmSearchParams, searchParamsToObject } from "../search-params";

describe("page searchParams", () => {
  it("read with await, as Farm's pages do, and directly, as RSC pages do", async () => {
    const search = searchParamsToObject(new URLSearchParams("token=abc&tag=a&tag=b"));
    const searchParams = createFarmSearchParams(search);
    expect(await searchParams).toEqual({ token: "abc", tag: ["a", "b"] });
    expect(searchParams.token).toBe("abc");
    expect(searchParams.tag).toEqual(["a", "b"]);
    expect({ ...searchParams }).toEqual({ token: "abc", tag: ["a", "b"] });
    expect(Object.keys(searchParams)).toEqual(["token", "tag"]);
  });

  it("stay a promise whatever the query names: then, catch and finally are read with await", async () => {
    const search = searchParamsToObject(new URLSearchParams("then=1&catch=2&finally=3&ok=4"));
    const searchParams = createFarmSearchParams(search);
    expect(typeof searchParams.then).toBe("function");
    expect(await searchParams).toEqual({ then: "1", catch: "2", finally: "3", ok: "4" });
    expect(searchParams.ok).toBe("4");
    expect(Object.getPrototypeOf(searchParams)).toBe(Promise.prototype);
  });

  it("are read-only", () => {
    const searchParams = createFarmSearchParams({ token: "abc" });
    expect(() => {
      (searchParams as { token: string }).token = "changed";
    }).toThrow(TypeError);
  });
});
