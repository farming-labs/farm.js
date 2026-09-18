import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import ts from "typescript";
import { generateRouteTypes } from "../routing/generate-route-types";
import { scanProgrammaticPagePaths } from "../routes-shared";
import { extractProgrammaticPageCallPathLiterals } from "../route-call-scanner";

function readTypeAlias(content: string, name: string): string {
  return content.match(new RegExp(`export type ${name} =([\\s\\S]*?);`))?.[1] ?? "";
}

/**
 * Regression coverage for the false-positive scanner bug in `scanProgrammaticPagePaths`.
 *
 * The text scraper must only collect `page("/…")` / `createRoute("/…")` arguments from
 * real call expressions. Text inside comments, string literals, regex literals, and
 * member-access calls (`.page(…)` / `?.page(…)`) must be ignored so the type-generation
 * step neither crashes (on `?`/`#`/`..` examples) nor silently widens the emitted
 * `RoutePath` / `RoutePattern` / `RouteModulePattern` unions with phantom routes.
 */
describe("scanProgrammaticPagePaths false-positive regressions", () => {
  describe("extractProgrammaticPageCallPathLiterals: token-aware extraction", () => {
    const cases: Array<[string, string, string[]]> = [
      [
        "line comment with query-string example",
        `// e.g. the old paginated search was page("/search?q=shoes") before we migrated.`,
        [],
      ],
      [
        "block comment with query-string example",
        `/* see also page("/list?sort=recent") in the old client */`,
        [],
      ],
      ["JSDoc @example block with hash example", `/** @example page("/docs#section") */`, []],
      [
        "JSDoc with createRoute and query example",
        `/**\n * pagination helper: see createRoute("/feed?page=N")\n */`,
        [],
      ],
      [
        "string literal containing a page call",
        `const note = "see page('/x?q=1') and // farm.routes before use";`,
        [],
      ],
      ["member call pager.page", `pager.page("/member/route");`, []],
      ["optional-chaining member call", `config?.page("/opt/member/route");`, []],
      ["dotted member createRoute", `lib.createRoute("/member/created");`, []],
      ["real page string literal", `page("/real/route", { component: X });`, ["/real/route"]],
      [
        "real createRoute string literal",
        `createRoute("/created/route", { component: Z });`,
        ["/created/route"],
      ],
      [
        "static backtick template literal",
        "page(`/backtick/static`, { component: Y });",
        ["/backtick/static"],
      ],
      ["dynamic backtick template literal excluded", "page(`/dyn/${id}`, { component: D });", []],
      ["await page call", `await page("/awaited/route", { component: A });`, ["/awaited/route"]],
      [
        "spread of page call preserved",
        `[...page("/spread/a"), ...page("/spread/b")];`,
        ["/spread/a", "/spread/b"],
      ],
      [
        "string with // then a real route on the next line",
        `const s = "see // farm.routes";\npage("/real/route", { component: X });`,
        ["/real/route"],
      ],
      [
        "regex with // then a real route on the next line",
        `const re = /^https?:\\/\\//.test(url);\npage("/regex/route", { component: R });`,
        ["/regex/route"],
      ],
      [
        "regex char class containing slash then a real route",
        `if (/[/]/.test(p)) page("/class/route");`,
        ["/class/route"],
      ],
      [
        "division not misread as regex then a real route",
        `const n = 100 / 5 / 2;\npage("/num/route");`,
        ["/num/route"],
      ],
      ["multiple page calls are deduplicated", `page("/a"); page("/a"); page("/b");`, ["/a", "/b"]],
      [
        "page with a non-literal first argument is skipped, literal kept",
        `page(maybePath); page("/literal");`,
        ["/literal"],
      ],
      [
        "page as object property is not a call",
        `const o = { page: 1, createRoute: 2 };\npage("/obj/route");`,
        ["/obj/route"],
      ],
      [
        "defineRoutes destructured page callback",
        `defineRoutes(({ page, layout }) => [ page("/destructured/route", { component: C }) ]);`,
        ["/destructured/route"],
      ],
      [
        "nested call expression wraps a real page route",
        `foo(page("/nested/route"));`,
        ["/nested/route"],
      ],
      [
        "ternary with page on both branches",
        `cond ? page("/then/route") : page("/else/route");`,
        ["/then/route", "/else/route"],
      ],
      [
        "comment between dot and page is still a member call",
        `obj./* */page("/member/comment/route");`,
        [],
      ],
    ];

    for (const [label, source, expected] of cases) {
      it(`extracts only real call-expression arguments: ${label}`, () => {
        const got = extractProgrammaticPageCallPathLiterals(source);
        expect([...got].sort()).toEqual([...expected].sort());
      });
    }
  });

  describe("scanProgrammaticPagePaths: no longer crashes on innocuous comment text", () => {
    it('does not throw on a line comment documenting page("/search?q=shoes")', () => {
      const source = `// e.g. the old paginated search was page("/search?q=shoes") before we migrated.`;
      expect(() => scanProgrammaticPagePaths(source)).not.toThrow();
      expect(scanProgrammaticPagePaths(source)).toEqual([]);
    });

    it('does not throw on a JSDoc @example with page("/docs#section")', () => {
      const source = `/** @example page("/docs#section") */`;
      expect(() => scanProgrammaticPagePaths(source)).not.toThrow();
      expect(scanProgrammaticPagePaths(source)).toEqual([]);
    });

    it('does not throw on a comment with createRoute("/feed?page=N")', () => {
      const source = `// pagination helper: see createRoute("/feed?page=N") for the removed API.`;
      expect(() => scanProgrammaticPagePaths(source)).not.toThrow();
      expect(scanProgrammaticPagePaths(source)).toEqual([]);
    });

    it('does not throw on a comment with a path-traversal example page("/a/../b")', () => {
      const source = `/* example: page("/a/../b") used to assert earlier */`;
      expect(() => scanProgrammaticPagePaths(source)).not.toThrow();
      expect(scanProgrammaticPagePaths(source)).toEqual([]);
    });

    it("still throws on a REAL call site with a query string (guard from #798 preserved)", () => {
      const source = `page("/search?q=shoes", { component: X });`;
      expect(() => scanProgrammaticPagePaths(source)).toThrow(
        /must be a pathname without a query string or hash/,
      );
    });

    it("still throws on a REAL call site with a browser-unstable segment (guard from #906 preserved)", () => {
      const source = `createRoute("/a/../b", { component: Y });`;
      expect(() => scanProgrammaticPagePaths(source)).toThrow(
        /browser-unstable|cannot contain backslashes/,
      );
    });

    it("excludes phantom comment-sourced paths and includes the real programmatic route", () => {
      const source = `
        // TODO: re-enable page("/abandoned/route") later
        /** Usage: page("/docs/example/route") to register a route. */
        page("/real/route", { component: R });
      `;
      const paths = scanProgrammaticPagePaths(source);
      expect(paths).toContain("/real/route");
      expect(paths).not.toContain("/abandoned/route");
      expect(paths).not.toContain("/docs/example/route");
    });
  });

  describe("generateRouteTypes: end-to-end type generation is crash-free and phantom-free", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-scanner-fp-"));
      await fs.promises.mkdir(path.join(tmpDir, "src"), { recursive: true });
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it("does not crash on a query-string example in a non-route file's comment", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "farm.routes.ts"),
        `
import { defineRoutes } from "@farm.js/core/routes";
import { MarketingPage } from "./marketing-page";

export default defineRoutes(({ page }) => [
  page("/marketing/[slug]", { component: MarketingPage }),
]);
`,
      );
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "search-util.ts"),
        `export function buildSearchUrl() { return ""; }
// e.g. the old paginated search was page("/search?q=shoes") before we migrated to [slug].
`,
      );

      const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain("`/marketing/${string}`");
      expect(content).toContain('"/marketing/[slug]"');
      expect(content).not.toContain("/search?q=shoes");
      expect(readTypeAlias(content, "RoutePath")).not.toContain("/search");
    });

    it("excludes phantom comment-sourced routes from the generated unions", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "farm.routes.ts"),
        `
import { defineRoutes } from "@farm.js/core/routes";
import { MarketingPage } from "./marketing-page";

export default defineRoutes(({ page }) => [
  page("/marketing/[slug]", { component: MarketingPage }),
]);
`,
      );
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "abandoned.ts"),
        `export const x = 1;
// TODO: re-enable page("/abandoned/route") later
`,
      );
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "docs-helper.ts"),
        `/** Usage: page("/docs/example/route") to register a route. */
export const helper = () => null;
`,
      );

      const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");
      const routePath = readTypeAlias(content, "RoutePath");
      const routePattern = readTypeAlias(content, "RoutePattern");
      const routeModulePattern = readTypeAlias(content, "RouteModulePattern");

      expect(content).toContain("`/marketing/${string}`");
      expect(content).toContain('"/marketing/[slug]"');
      for (const phantom of ["/abandoned/route", "/docs/example/route"]) {
        expect(routePath).not.toContain(phantom);
        expect(routePattern).not.toContain(phantom);
        expect(routeModulePattern).not.toContain(phantom);
      }
    });

    it("still emits real page() routes when source contains // and /* inside string/regex literals", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "farm.routes.ts"),
        `
const note = "see // farm.routes and /* not a comment */ for context";
const isHttp = /^https?:\\/\\//.test(url);
export default defineRoutes(({ page }) => [
  page("/regex/real/route", { component: X }),
  page(\`/backtick/static/route\`, { component: Y }),
]);
`,
      );

      const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain('"/regex/real/route"');
      expect(content).toContain('"/backtick/static/route"');
      // Dynamic backtick templates must not leak into the unions as literal phantoms.
      expect(content).not.toContain("${");
      // The // and /* inside the string and regex must not have swallowed the real routes.
      expect(readTypeAlias(content, "RoutePath")).toContain('"/regex/real/route"');
      expect(readTypeAlias(content, "RoutePath")).toContain('"/backtick/static/route"');
    });

    it("preserves static backtick routes and excludes dynamic backtick templates", async () => {
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "farm.routes.ts"),
        `
export default defineRoutes(({ page }) => [
  page(\`/backtick/static/route\`, { component: A }),
  page(\`/backtick/dynamic/\${id}\`, { component: B }),
]);
`,
      );

      const outPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
      const content = fs.readFileSync(outPath, "utf8");

      expect(content).toContain('"/backtick/static/route"');
      expect(content).not.toContain("/backtick/dynamic/");
      expect(content).not.toContain("${");
    });
  });

  describe("over-inclusion no longer widens PageProps/RouteModule at the type level", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "farm-scanner-types-"));
      await fs.promises.mkdir(path.join(tmpDir, "src"), { recursive: true });
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "farm.routes.ts"),
        `
export default defineRoutes(({ page }) => [
  page("/real/route", { component: R }),
]);
`,
      );
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "abandoned.ts"),
        `// TODO: re-enable page("/abandoned/route") later
export const x = 1;
`,
      );
      await fs.promises.writeFile(
        path.join(tmpDir, "src", "docs-helper.ts"),
        `/** Usage: page("/docs/example/route") to register a route. */
export const helper = () => null;
`,
      );
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it("rejects comment-sourced phantom routes at PageProps/RouteModule/AppRoutePattern", async () => {
      const generatedTypesPath = await generateRouteTypes({ root: tmpDir, srcDir: "src" });
      const typeTestPath = path.join(tmpDir, "route-props.type-test.ts");
      await fs.promises.writeFile(
        typeTestPath,
        `
import type {
  AppRoutePattern,
  PageProps,
  RouteModule,
} from "@farm.js/core";

// Real programmatic route is present in the generated unions.
const real: AppRoutePattern = "/real/route";
declare const realPage: PageProps<"/real/route">;
declare const realModule: RouteModule<"/real/route">;
void [real, realPage, realModule];

// Comment-sourced phantom routes are no longer accepted by the unions.
// @ts-expect-error comment-sourced phantom is not in the route union
const abandoned: AppRoutePattern = "/abandoned/route";
// @ts-expect-error comment-sourced phantom is not in the route union
const docs: AppRoutePattern = "/docs/example/route";
// @ts-expect-error phantom routes do not satisfy PageProps<Route>
declare const abandonedPage: PageProps<"/abandoned/route">;
// @ts-expect-error phantom routes do not satisfy RouteModule<Route>
declare const docsModule: RouteModule<"/docs/example/route">;
// @ts-expect-error genuinely-absent routes are still rejected
const trulyMissing: AppRoutePattern = "/totally/fake";
void [abandoned, docs, trulyMissing];
void [abandonedPage, docsModule];
`,
      );

      const program = ts.createProgram({
        rootNames: [generatedTypesPath, typeTestPath],
        options: {
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          target: ts.ScriptTarget.ES2020,
          module: ts.ModuleKind.ESNext,
          moduleResolution: ts.ModuleResolutionKind.Bundler,
          jsx: ts.JsxEmit.ReactJSX,
          baseUrl: process.cwd(),
          paths: {
            "@farm.js/core": ["./src/types.ts"],
            "@farm.js/core/client": ["./types/client.d.ts"],
            "@farm.js/core/routes": ["./src/routes.ts"],
          },
        },
      });
      const diagnostics = ts.getPreEmitDiagnostics(program);
      const formatted = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => "\n",
      });

      expect(formatted).toBe("");
    }, 30_000);
  });
});
