import { describe, expect, it } from "vitest";
import { generateClientHydrationEntry } from "../nitro/universal-build";

const generate = (islandValues: boolean) =>
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
});
