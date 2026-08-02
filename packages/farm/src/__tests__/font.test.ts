import { describe, expect, it } from "vitest";
import { defineLayoutFonts, resolveFarmLayoutFonts, type FarmFont } from "../font";

function font(family: string): FarmFont {
  return {
    className: `font-${family}`,
    variable: "",
    style: { fontFamily: `"${family}", sans-serif` },
    preloads: [],
  };
}

describe("layout font inheritance", () => {
  it("lets the nearest layout override one role while inheriting the others", () => {
    const rootBody = font("Root Body");
    const rootCode = font("Root Code");
    const docsBody = font("Docs Body");

    const resolved = resolveFarmLayoutFonts([
      { fonts: defineLayoutFonts({ body: rootBody, code: rootCode }) },
      {},
      { fonts: defineLayoutFonts({ body: docsBody }) },
    ]);

    expect(resolved).toEqual({ body: docsBody, code: rootCode });
  });

  it("returns undefined when no applicable layout declares fonts", () => {
    expect(resolveFarmLayoutFonts([{}, {}])).toBeUndefined();
  });
});
