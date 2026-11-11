// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_COMPILER_DIRECTIVE,
  DEFAULT_COMPILER_REPORT_FILE,
  normalizeReactCompilerOptions,
  react,
} from "../index";

describe("React renderer capabilities", () => {
  it("keeps functionComponents on the descriptor react() builds", () => {
    // react() rebuilds capabilities rather than spreading them, so a new
    // capability has to be added here too. Integration provider components are
    // gated on this one: dropping it makes them throw on React apps.
    expect(react().capabilities?.functionComponents).toBe(true);
    expect(react({ compiler: true }).capabilities?.functionComponents).toBe(true);
  });

  it("keeps the edge streaming override on cloned descriptors", () => {
    expect(react().capabilities?.streaming).toEqual({
      node: true,
      web: false,
      runtimes: { edge: { node: false, web: true } },
    });
  });
});

describe("React renderer compiler options", () => {
  it("keeps the compiler disabled unless the compiler option is enabled", () => {
    expect(react().options).toEqual({ compiler: false });
    expect(react({ compiler: false }).options).toEqual({ compiler: false });
  });

  it("uses automatic inference for compiler: true", () => {
    expect(react({ compiler: true }).options).toEqual({
      compiler: {
        mode: "infer",
        directive: DEFAULT_COMPILER_DIRECTIVE,
        onUnsupported: "fallback",
        reactivity: "hybrid",
        report: false,
        reportFile: DEFAULT_COMPILER_REPORT_FILE,
        compiledRoot: true,
      },
    });
  });

  it("supports a configurable directive in annotation mode", () => {
    expect(
      react({ compiler: { mode: "annotation", directive: "use fast component" } }).options,
    ).toEqual({
      compiler: {
        mode: "annotation",
        directive: "use fast component",
        onUnsupported: "fallback",
        reactivity: "hybrid",
        report: false,
        reportFile: DEFAULT_COMPILER_REPORT_FILE,
        compiledRoot: true,
      },
    });
  });

  it("keeps experimental.compiler as a deprecated alias that warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(react({ experimental: { compiler: { reactivity: "static" } } }).options).toEqual(
        react({ compiler: { reactivity: "static" } }).options,
      );
      react({ experimental: { compiler: true } });
      const deprecations = warn.mock.calls.filter(([message]) =>
        String(message).includes("experimental: { compiler }"),
      );
      // Once per process, however many configs or builds call react().
      expect(deprecations).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects configuring the compiler under both keys", () => {
    expect(() => react({ compiler: true, experimental: { compiler: false } })).toThrow(
      /`compiler` only/,
    );
  });

  it.each([null, 0, 1, "", "true", [], () => true].map((compiler) => ({ compiler })))(
    "rejects invalid compiler configuration $compiler instead of enabling or disabling silently",
    ({ compiler }) => {
      for (const options of [{ compiler }, { experimental: { compiler } }]) {
        expect(() => react(options as Parameters<typeof react>[0])).toThrow(
          /compiler must be a boolean or compiler options object/i,
        );
      }
    },
  );

  it("rejects directives outside annotation mode", () => {
    expect(() =>
      normalizeReactCompilerOptions({
        mode: "infer",
        directive: "use compiler",
      }),
    ).toThrow(/annotation mode/i);
  });

  it("normalizes compiler coverage reporting", () => {
    expect(
      normalizeReactCompilerOptions({
        report: true,
        reportFile: "reports/react-compiler.json",
      }),
    ).toEqual({
      mode: "infer",
      directive: DEFAULT_COMPILER_DIRECTIVE,
      onUnsupported: "fallback",
      reactivity: "hybrid",
      report: true,
      reportFile: "reports/react-compiler.json",
      compiledRoot: true,
    });
    expect(normalizeReactCompilerOptions({ reportFile: "coverage/compiler.json" }).report).toBe(
      true,
    );
  });

  it("supports static scheduling and rejects unknown reactivity modes", () => {
    expect(normalizeReactCompilerOptions({ reactivity: "static" }).reactivity).toBe("static");
    expect(() => normalizeReactCompilerOptions({ reactivity: "signals" as "hybrid" })).toThrow(
      /reactivity mode/i,
    );
  });

  it("mounts compiled roots without React DOM unless disabled", () => {
    expect(normalizeReactCompilerOptions(true).compiledRoot).toBe(true);
    expect(normalizeReactCompilerOptions({ compiledRoot: false }).compiledRoot).toBe(false);
    expect(() => normalizeReactCompilerOptions({ compiledRoot: "yes" as never })).toThrow(
      /compiledRoot/,
    );
  });

  it("keeps compiler reports inside the project root", () => {
    expect(() =>
      normalizeReactCompilerOptions({ report: true, reportFile: "../outside.json" }),
    ).toThrow(/project root/i);
    expect(() =>
      normalizeReactCompilerOptions({ report: false, reportFile: "compiler.json" }),
    ).toThrow(/reporting is false/i);
  });
});
