import { describe, expect, it } from "vitest";
import { resolveSearchOptions } from "./config";

describe("resolveSearchOptions", () => {
  it("keeps the default contract small and production-safe", () => {
    expect(resolveSearchOptions()).toEqual({
      include: ["/**"],
      exclude: [],
      output: "_farm/search",
      rootSelector: undefined,
      excludeSelectors: [],
      language: undefined,
      includeCharacters: undefined,
      keepIndexUrl: false,
      excerptLength: 30,
      highlightParam: undefined,
      verbose: false,
    });
  });

  it("normalizes route patterns, language, and output", () => {
    expect(
      resolveSearchOptions({
        include: ["docs/**", "/blog/*"],
        exclude: ["account/**"],
        output: "/assets/site-search/",
        language: "EN",
        excerptLength: 48,
        highlightParam: "query",
      }),
    ).toMatchObject({
      include: ["/docs/**", "/blog/*"],
      exclude: ["/account/**"],
      output: "assets/site-search",
      language: "en",
      excerptLength: 48,
      highlightParam: "query",
    });
  });

  it("rejects unsafe output paths and misleading options", () => {
    expect(() => resolveSearchOptions({ output: "../outside" })).toThrow(
      "inside the public output directory",
    );
    expect(() => resolveSearchOptions({ output: "search\\index" })).toThrow(
      "inside the public output directory",
    );
    for (const output of [
      "%2e%2e/search",
      "search/%2Findex",
      "search/%5cindex",
      "search/%00index",
    ]) {
      expect(() => resolveSearchOptions({ output })).toThrow("inside the public output directory");
    }
    expect(() => resolveSearchOptions({ language: "english" })).toThrow("ISO 639-1");
    expect(() => resolveSearchOptions({ excerptLength: 0 })).toThrow("excerptLength");
    expect(() => resolveSearchOptions({ verbose: "yes" } as never)).toThrow(
      "verbose must be a boolean",
    );
    expect(() => resolveSearchOptions({ enabled: true } as never)).toThrow(
      "remove search() from plugins",
    );
  });
});
