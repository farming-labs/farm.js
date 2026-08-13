// @vitest-environment node

import { describe, expect, it } from "vitest";
import { DEFAULT_COMPILER_DIRECTIVE, normalizeReactCompilerOptions, react } from "../index";

describe("React renderer compiler options", () => {
  it("keeps the compiler disabled unless the experimental option is enabled", () => {
    expect(react().options).toEqual({ experimental: { compiler: false } });
  });

  it("uses automatic inference for compiler: true", () => {
    expect(react({ experimental: { compiler: true } }).options).toEqual({
      experimental: {
        compiler: {
          mode: "infer",
          directive: DEFAULT_COMPILER_DIRECTIVE,
          onUnsupported: "fallback",
        },
      },
    });
  });

  it("supports a configurable directive in annotation mode", () => {
    expect(
      react({
        experimental: {
          compiler: { mode: "annotation", directive: "use fast component" },
        },
      }).options,
    ).toEqual({
      experimental: {
        compiler: {
          mode: "annotation",
          directive: "use fast component",
          onUnsupported: "fallback",
        },
      },
    });
  });

  it("rejects directives outside annotation mode", () => {
    expect(() =>
      normalizeReactCompilerOptions({
        mode: "infer",
        directive: "use compiler",
      }),
    ).toThrow(/annotation mode/i);
  });
});
