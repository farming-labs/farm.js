// @vitest-environment node

import * as rolldownUtils from "rolldown/utils";
import { describe, expect, it } from "vitest";
import { restoreLiteralModuleSpecifiers } from "../nitro/universal-build";
import { SERVER_CHUNK_SPECIFIER_CASES } from "./fixtures/server-chunk-specifiers";

/** rolldown/utils whose parse result counts reads of the JSON-decoded `program`. */
function createCountingUtils() {
  const counts = { parses: 0, programReads: 0 };
  const parseSync: typeof rolldownUtils.parseSync = (...args) => {
    counts.parses += 1;
    const result = rolldownUtils.parseSync(...args);
    return {
      get program() {
        counts.programReads += 1;
        return result.program;
      },
      get module() {
        return result.module;
      },
      get comments() {
        return result.comments;
      },
      get errors() {
        return result.errors;
      },
    };
  };
  return { counts, utils: { parseSync, Visitor: rolldownUtils.Visitor } };
}

function findCase(name: string) {
  const found = SERVER_CHUNK_SPECIFIER_CASES.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing fixture ${name}`);
  return found;
}

describe("restoreLiteralModuleSpecifiers", () => {
  it.each(SERVER_CHUNK_SPECIFIER_CASES)("matches the recorded output: $name", (entry) => {
    expect(restoreLiteralModuleSpecifiers(entry.input, entry.fileName, rolldownUtils)).toBe(
      entry.expected,
    );
  });

  it("restores import() in a chunk with Rolldown's __require() helper without decoding the AST", () => {
    const entry = findCase("Rolldown entry chunk with CommonJS interop and page loaders");
    const { counts, utils } = createCountingUtils();

    const code = restoreLiteralModuleSpecifiers(entry.input, entry.fileName, utils);

    expect(code).toContain('import("./home-DLgwQDLE.js")');
    expect(code).toContain("__require(`events`)");
    expect(counts).toEqual({ parses: 1, programReads: 0 });
  });

  it.each([
    "require() template call next to __require()",
    "spread require() template call",
    "require() template call at the start of the chunk",
  ])("decodes the AST for a require() template call: %s", (name) => {
    const entry = findCase(name);
    const { counts, utils } = createCountingUtils();

    const code = restoreLiteralModuleSpecifiers(entry.input, entry.fileName, utils);

    expect(code).toMatch(/(?<![\w$])require\("/);
    expect(code).toContain("__require(`fs`)");
    expect(counts.programReads).toBe(1);
  });

  it("leaves identifier-prefixed require() templates to the module record", () => {
    const entry = findCase("only identifier-prefixed require() templates");
    const { counts, utils } = createCountingUtils();

    const code = restoreLiteralModuleSpecifiers(entry.input, entry.fileName, utils);

    expect(code).toContain('import("./page.mjs")');
    expect(code).toContain("_require(`./y.cjs`)");
    expect(code).toContain("$require(`./z.cjs`)");
    expect(counts.programReads).toBe(0);
  });
});
