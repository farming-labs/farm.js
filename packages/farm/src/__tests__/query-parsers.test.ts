import { describe, expect, it } from "vitest";
import { asArrayOf, asJson, asString } from "../query/parsers";

describe("query parsers", () => {
  it("keeps the readable comma format for simple arrays", () => {
    const parser = asArrayOf(asString);

    expect(parser.serialize(["react", "vite"])).toBe("react,vite");
    expect(parser.parse("react,vite")).toEqual(["react", "vite"]);
  });

  it("round-trips array items containing the delimiter", () => {
    const parser = asArrayOf(asString, { format: "structured" });
    const value = ["New York, NY", "Los Angeles, CA"];

    expect(parser.parse(parser.serialize(value))).toEqual(value);
  });

  it("round-trips serialized nested values and empty items", () => {
    const jsonParser = asArrayOf(asJson<{ label: string; count: number }>(), {
      format: "structured",
    });
    const jsonValue = [
      { label: "alpha, beta", count: 1 },
      { label: "gamma", count: 2 },
    ];
    const stringParser = asArrayOf(
      {
        parse: (value: string) => value,
        serialize: (value: string) => value,
      },
      { format: "structured" },
    );

    expect(jsonParser.parse(jsonParser.serialize(jsonValue))).toEqual(jsonValue);
    expect(stringParser.parse(stringParser.serialize(["", "value"]))).toEqual(["", "value"]);
  });

  it("round-trips items whose surrounding whitespace is significant", () => {
    const parser = asArrayOf(
      {
        parse: (value: string) => value,
        serialize: (value: string) => value,
      },
      { format: "structured" },
    );

    expect(parser.parse(parser.serialize([" leading", "trailing ", " "]))).toEqual([
      " leading",
      "trailing ",
      " ",
    ]);
  });

  it("keeps legacy values using the old structured-looking prefix", () => {
    const parser = asArrayOf(asString);

    expect(parser.parse("~[]")).toEqual(["~[]"]);
    expect(parser.parse('~["a"]')).toEqual(['~["a"]']);
  });

  it("does not reserve the structured namespace in the default comma format", () => {
    const parser = asArrayOf(asString);
    const value = '~farm-array:v1:["legacy"]';

    expect(parser.parse(value)).toEqual([value]);
    expect(parser.serialize([value])).toBe(value);
  });

  it("escapes values in the versioned structured namespace", () => {
    const parser = asArrayOf(asString, { format: "structured" });
    const value = ['~farm-array:v1:["legacy"]'];

    expect(parser.parse(parser.serialize(value))).toEqual(value);
  });

  it("keeps malformed structured-looking values on the legacy path", () => {
    const parser = asArrayOf(asString);

    expect(parser.parse("~[not-json,second")).toEqual(["~[not-json", "second"]);
  });
});
