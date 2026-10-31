import { describe, expect, it } from "vitest";
import { isNitroRollupExternal } from "../nitro/universal-build";

describe("Farm's Nitro externals", () => {
  it("bundles Nitro's runtime, which handlers from Nitro modules import by name", () => {
    expect(isNitroRollupExternal("nitro")).toBe(false);
    expect(isNitroRollupExternal("nitro/storage")).toBe(false);
  });

  it("keeps build tools and native modules external", () => {
    for (const id of ["vite", "rolldown", "nitropack", "sharp", "node:fs", "fs"]) {
      expect(isNitroRollupExternal(id)).toBe(true);
    }
  });
});
