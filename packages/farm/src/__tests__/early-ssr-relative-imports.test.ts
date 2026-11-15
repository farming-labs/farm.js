// @vitest-environment node

import { parseSync } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";

// Module code as the SSR transform sees it: Vite has already compiled TypeScript and JSX away.
const MODULE = `import a from "./a.js";
import "./side.css?inline";
import b from '../lib/b';
export { c } from "./c";
export * from "./d";
const e = import("./e");
const f = import(\`./f\`);
const g = import(name);
// import "./comment"
const h = "import('./string')";
import pkg from "pkg";
const url = import.meta.url;
import data from "./data.json" with { type: "json" };
`;

const EXPECTED = `import a from "/src/routes/a.js";
import "/src/routes/side.css?inline";
import b from "/src/lib/b";
export { c } from "/src/routes/c";
export * from "/src/routes/d";
const e = import("/src/routes/e");
const f = import(\`./f\`);
const g = import(name);
// import "./comment"
const h = "import('./string')";
import pkg from "pkg";
const url = import.meta.url;
import data from "/src/routes/data.json" with { type: "json" };
`;

const parse = (code: string) => parseSync("module.js", code).program as never;
const options = { id: "/app/src/routes/page.js", root: "/app", parse };

afterEach(() => {
  vi.doUnmock("es-module-lexer");
  vi.resetModules();
});

describe("rewriteEarlySsrRelativeImports", () => {
  it("rewrites relative string specifiers to root module ids, leaving everything else", async () => {
    const { rewriteEarlySsrRelativeImports } = await import("../vite");
    expect(rewriteEarlySsrRelativeImports({ ...options, code: MODULE })).toBe(EXPECTED);
  });

  it("reads specifiers without parsing the module", async () => {
    const { rewriteEarlySsrRelativeImports } = await import("../vite");
    const parseSpy = vi.fn(parse);
    rewriteEarlySsrRelativeImports({ ...options, code: MODULE, parse: parseSpy });
    expect(parseSpy).not.toHaveBeenCalled();
  });

  it("falls back to parsing the module when the lexer cannot read it, with the same result", async () => {
    vi.resetModules();
    vi.doMock("es-module-lexer", async (importOriginal) => ({
      ...(await importOriginal<typeof import("es-module-lexer")>()),
      parse: () => {
        throw new Error("unreadable");
      },
    }));
    const { rewriteEarlySsrRelativeImports } = await import("../vite");
    const parseSpy = vi.fn(parse);
    expect(rewriteEarlySsrRelativeImports({ ...options, code: MODULE, parse: parseSpy })).toBe(
      EXPECTED,
    );
    expect(parseSpy).toHaveBeenCalledOnce();
  });

  it("leaves a module without relative specifiers, and node_modules files, untouched", async () => {
    const { rewriteEarlySsrRelativeImports } = await import("../vite");
    expect(rewriteEarlySsrRelativeImports({ ...options, code: 'import x from "pkg";\n' })).toBe(
      null,
    );
    expect(
      rewriteEarlySsrRelativeImports({
        ...options,
        id: "/app/node_modules/pkg/index.js",
        code: MODULE,
      }),
    ).toBe(null);
  });
});
