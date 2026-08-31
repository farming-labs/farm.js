import { describe, expect, it } from "vitest";
import { asFloat, asInteger, asString } from "../query/parsers";
import { loadRouteParams, parseRouteParams } from "../query/params";

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

  it("rejects partial and non-finite numeric values", () => {
    expect(asInteger.parse("42")).toBe(42);
    expect(asInteger.parse("42px")).toBeNull();
    expect(asInteger.parse("1.5")).toBeNull();
    expect(asInteger.parse("9007199254740992")).toBeNull();
    expect(asInteger.withDefault!(7).parse("12items")).toBe(7);

    expect(asFloat.parse("-1.25e2")).toBe(-125);
    expect(asFloat.parse("1.5rem")).toBeNull();
    expect(asFloat.parse("Infinity")).toBeNull();
    expect(asFloat.parse(" 1.5 ")).toBeNull();
    expect(asFloat.withDefault!(0.5).parse("4.2px")).toBe(0.5);
  });
});
