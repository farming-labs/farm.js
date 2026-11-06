import { describe, expect, it } from "vitest";
import { generateClientHydrationEntry } from "../nitro/universal-build";

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
