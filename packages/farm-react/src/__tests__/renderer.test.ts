// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COMPILER_DIRECTIVE,
  DEFAULT_COMPILER_REPORT_FILE,
  normalizeReactCompilerOptions,
  react,
} from "../index";

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
          report: false,
          reportFile: DEFAULT_COMPILER_REPORT_FILE,
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
          report: false,
          reportFile: DEFAULT_COMPILER_REPORT_FILE,
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
      report: true,
      reportFile: "reports/react-compiler.json",
    });
    expect(normalizeReactCompilerOptions({ reportFile: "coverage/compiler.json" }).report).toBe(
      true,
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
