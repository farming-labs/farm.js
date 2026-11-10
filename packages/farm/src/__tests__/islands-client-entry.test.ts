import { describe, expect, it } from "vitest";
import { generateClientHydrationEntry, splitFarmClientRouter } from "../nitro/universal-build";

const generate = (islandValues: boolean, serverStylesheets: string[] = []) =>
  generateClientHydrationEntry(
    [],
    [],
    [],
    "/app",
    "src",
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    undefined,
    undefined,
    false,
    [],
    "/",
    undefined,
    undefined,
    islandValues,
    undefined,
    serverStylesheets,
  );

describe("the islands-mode client entry", () => {
  it.each([true, false])(
    "defines every helper it calls, for an app with server pages only (islands: %s)",
    (islandValues) => {
      const entry = generate(islandValues);
      // An islands app without client components still waits for the document before the docs
      // runtime hydrates.
      if (entry.includes("farmDocumentParsed()")) {
        expect(entry).toContain("function farmDocumentParsed()");
      }
      expect(entry.includes("farmDocumentParsed()")).toBe(islandValues);
    },
  );

  it("imports the stylesheets server modules import, keeping each CSS module's class map", () => {
    const entry = generate(true, ["/app/src/app/page.css", "/app/src/card.module.css"]);
    expect(entry).toContain('import "/app/src/app/page.css";');
    // Left unused, a CSS module's class map would be tree-shaken with its stylesheet.
    expect(entry).toContain('import * as __farmServerStyle0 from "/app/src/card.module.css";');
    expect(entry).toContain("globalThis.__FARM_SERVER_STYLES__ = [__farmServerStyle0];");
    expect(generate(true)).not.toContain("__farmServerStyle");
  });
});

describe("splitFarmClientRouter", () => {
  const source = [
    'import { eagerOnly, both, routerOnly, spreadOnly } from "pkg";',
    "const shared = 1;",
    "const unrelated = 2;",
    "eagerOnly(both, unrelated);",
    "/*farm-router-start*/",
    "const spaRouter = { go() { return [shared, both(), routerOnly(), obj.unrelated, { ...spreadOnly() }]; } };",
    "/*farm-router-end*/",
    "/*farm-router-stub*/",
  ].join("\n");

  it("moves the marked code and leaves the stand-in router in the entry", () => {
    const { entry, router } = splitFarmClientRouter(source);
    expect(router).toContain("const spaRouter = { go()");
    expect(router).toContain("export { spaRouter };");
    expect(entry).not.toContain("go()");
    expect(entry).not.toContain("farm-router-stub");
    expect(entry).toContain("function loadFarmRouter()");
  });

  it("imports only what the router uses, through the entry when the entry uses it too", () => {
    const { entry, router } = splitFarmClientRouter(source);
    expect(entry).toContain("export { both, shared };");
    expect(router).toContain('import { both, shared } from "./farm-client-entry";');
    expect(router).toContain('import { routerOnly } from "pkg";');
    // A spread is the binding, a property after one dot is not.
    expect(router).toContain('import { spreadOnly } from "pkg";');
    expect(router).not.toMatch(/import \{[^}]*\bunrelated\b/);
  });

  it("leaves the markers inert in an entry that is not split", () => {
    const code = generate(false);
    expect(code).not.toContain("function loadFarmRouter()");
    expect(code).toContain("const spaRouter = {");
  });
});
