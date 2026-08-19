// @vitest-environment node

import { describe, expect, it } from "vitest";
import { toVirtualEntryImportSpecifier } from "../nitro/universal-build";

describe("toVirtualEntryImportSpecifier", () => {
  it("emits forward-slash specifiers for Windows paths", () => {
    // A raw backslash path inside a generated import statement is read as
    // escape sequences (`\f`, `\t`, ...), producing a specifier the bundler
    // cannot resolve: Rolldown failed to resolve import "E:\..." (#393).
    expect(toVirtualEntryImportSpecifier("E:\\farming\\app\\src\\app\\api\\scan\\route.ts")).toBe(
      '"E:/farming/app/src/app/api/scan/route.ts"',
    );
  });

  it("keeps POSIX paths unchanged apart from quoting", () => {
    expect(toVirtualEntryImportSpecifier("/workspace/app/src/app/api/scan/route.ts")).toBe(
      '"/workspace/app/src/app/api/scan/route.ts"',
    );
  });

  it("produces a valid JavaScript string literal with no unescaped backslashes", () => {
    const specifier = toVirtualEntryImportSpecifier("E:\\farming\\app\\src\\middleware.ts");
    expect(specifier).not.toContain("\\");
    expect(JSON.parse(specifier)).toBe("E:/farming/app/src/middleware.ts");
  });
});
