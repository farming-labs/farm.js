import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("client plugin hydration ordering", () => {
  it.each(["vite.ts", path.join("nitro", "universal-build.ts")])(
    "waits for client setup before any initial hydration in %s",
    (sourceFile) => {
      const source = fs.readFileSync(path.join(process.cwd(), "src", sourceFile), "utf8");
      const hydrateStart = source.indexOf("async function hydrate() {");
      const setup = source.indexOf("await farmClientRuntime.start();", hydrateStart);
      const routeSlots = source.indexOf("hydrateInitialRouteSlots", hydrateStart);

      expect(hydrateStart).toBeGreaterThan(-1);
      expect(setup).toBeGreaterThan(hydrateStart);
      expect(routeSlots).toBeGreaterThan(setup);
    },
  );
});
