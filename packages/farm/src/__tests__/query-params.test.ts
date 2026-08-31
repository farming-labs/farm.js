import { describe, expect, it } from "vitest";
import { asFloat, asInteger, asIsoDate, asIsoDateTime, asString } from "../query/parsers";
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

  it("keeps ISO dates and date-times distinct and calendar-valid", () => {
    expect(asIsoDate.parse("2024-02-29")?.toISOString()).toBe("2024-02-29T00:00:00.000Z");
    expect(asIsoDate.serialize(new Date("2024-02-29T18:00:00.000Z"))).toBe("2024-02-29");
    expect(asIsoDate.parse("2023-02-29")).toBeNull();
    expect(asIsoDate.parse("2024-02-29T00:00:00Z")).toBeNull();
    expect(asIsoDate.parse("February 29, 2024")).toBeNull();

    expect(asIsoDateTime.parse("2024-02-29T23:30:00+02:00")?.toISOString()).toBe(
      "2024-02-29T21:30:00.000Z",
    );
    expect(asIsoDateTime.parse("2024-02-30T12:00:00Z")).toBeNull();
    expect(asIsoDateTime.parse("2024-02-29T12:00:00")).toBeNull();
    expect(asIsoDateTime.parse("2024-02-29")).toBeNull();
    expect(asIsoDateTime.parse("2024-02-29T24:00:00Z")).toBeNull();

    const fallback = new Date("2000-01-01T00:00:00.000Z");
    expect(asIsoDateTime.withDefault!(fallback).parse("tomorrow")).toBe(fallback);
  });
});
