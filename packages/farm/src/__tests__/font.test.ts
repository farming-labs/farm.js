import { describe, expect, it } from "vitest";
import {
  defineLayoutFonts,
  inferFarmLayoutFonts,
  resolveFarmLayoutFonts,
  type FarmFont,
} from "../font";

function font(family: string, generic = "sans-serif"): FarmFont {
  return {
    className: `font-${family}`,
    variable: "",
    style: { fontFamily: `"${family}", ${generic}` },
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

describe("layout fonts inferred from the classes a layout applies", () => {
  it("takes body from the applied className and code from the first other monospace font", () => {
    const sans = font("Sans");
    const mono = font("Mono", "ui-monospace, monospace");
    const pixel = font("Pixel", "monospace");

    expect(
      inferFarmLayoutFonts([
        [sans, "variable"],
        [mono, "variable"],
        [pixel, "variable"],
        [sans, "className"],
      ]),
    ).toEqual({ body: sans, code: mono });
  });

  it("takes body from the first font that is not monospace when only variables are applied", () => {
    const mono = font("Mono", "monospace");
    const sans = font("Sans");

    expect(
      inferFarmLayoutFonts([
        [mono, "variable"],
        [sans, "variable"],
      ]),
    ).toEqual({ body: sans, code: mono });
  });

  it("ignores values that are not compiled fonts", () => {
    expect(inferFarmLayoutFonts([[{ className: "card" }, "className"]])).toBeUndefined();
    expect(inferFarmLayoutFonts([[undefined, "variable"]])).toBeUndefined();
  });

  it("uses inferred roles only for a layout without a fonts export", () => {
    const declared = font("Declared");
    const inferred = font("Inferred");
    const inferredCode = font("Inferred Mono", "monospace");

    expect(
      resolveFarmLayoutFonts([
        { __farmLayoutFonts: { body: inferred, code: inferredCode } },
        { fonts: { body: declared }, __farmLayoutFonts: { body: inferred } },
      ]),
    ).toEqual({ body: declared, code: inferredCode });
  });
});
