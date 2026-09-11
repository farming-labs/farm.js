import { describe, expect, it } from "vitest";
import { resolveStylexOptions } from "./config.js";

describe("resolveStylexOptions", () => {
  it("keeps externalPackages and removes duplicates", () => {
    expect(
      resolveStylexOptions({
        externalPackages: ["@acme/ui", "shared-styles", "@acme/ui"],
        useCSSLayers: true,
      }),
    ).toEqual({
      externalPackages: ["@acme/ui", "shared-styles"],
      useCSSLayers: true,
    });
  });

  it.each(["", "./ui", "/ui", "@acme/ui/button", "ui/button", "ui\\button"])(
    "rejects invalid external package name %j",
    (externalPackage) => {
      expect(() => resolveStylexOptions({ externalPackages: [externalPackage] })).toThrow(
        "package names",
      );
    },
  );
});
