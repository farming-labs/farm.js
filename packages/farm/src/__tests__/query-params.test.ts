import { describe, expect, it } from "vitest";
import { asArrayOf, asInteger, asString } from "../query/parsers";
import { loadRouteParams, parseRouteParams } from "../query/params";
import { loadSearchParams } from "../query/server";

describe("query route params parsing", () => {
  it("parses route params synchronously with parser types", () => {
    const parsed = parseRouteParams(
      { id: "42", slug: "hello-world" },
      {
        id: asInteger,
        slug: asString,
      },
    );

    expect(parsed.id).toBe(42);
    expect(parsed.slug).toBe("hello-world");
  });

  it("loads route params from async input", async () => {
    const parsed = await loadRouteParams(Promise.resolve({ id: "7", slug: "release-notes" }), {
      id: asInteger.withDefault!(0),
      slug: asString.withDefault!(""),
    });

    expect(parsed.id).toBe(7);
    expect(parsed.slug).toBe("release-notes");
  });

  it("throws in strict mode when parser fails", () => {
    expect(() =>
      parseRouteParams(
        { id: "invalid" },
        {
          id: asInteger,
        },
        { strict: true },
      ),
    ).toThrow('Failed to parse route param "id"');
  });
});

describe("loadSearchParams", () => {
  it("keeps every value of a repeated parameter", async () => {
    // The searchParams page prop collects repeated keys into arrays.
    await expect(
      loadSearchParams(Promise.resolve({ tag: ["react", "vite", "zod"] }), {
        tag: asArrayOf(asString),
      }),
    ).resolves.toEqual({ tag: ["react", "vite", "zod"] });

    await expect(
      loadSearchParams(Promise.resolve(new URLSearchParams("tag=react&tag=vite&tag=zod")), {
        tag: asArrayOf(asString),
      }),
    ).resolves.toEqual({ tag: ["react", "vite", "zod"] });
  });

  it("keeps single and comma-joined values working unchanged", async () => {
    await expect(
      loadSearchParams(Promise.resolve({ tag: "react,vite" }), {
        tag: asArrayOf(asString),
      }),
    ).resolves.toEqual({ tag: ["react", "vite"] });

    await expect(
      loadSearchParams(Promise.resolve({ q: "farm" }), {
        q: asString,
      }),
    ).resolves.toEqual({ q: "farm" });
  });

  it("round-trips asArrayOf serialize output", async () => {
    const parser = asArrayOf(asString);
    const serialized = parser.serialize(["react", "vite", "zod"]);
    await expect(
      loadSearchParams(Promise.resolve(new URLSearchParams({ tag: serialized })), {
        tag: parser,
      }),
    ).resolves.toEqual({ tag: ["react", "vite", "zod"] });
  });
});
