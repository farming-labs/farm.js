import packageJson from "../../package.json";
import { describe, expect, it } from "vitest";
import { FARM_VERSION } from "../version";

describe("FARM_VERSION", () => {
  it("matches the published core package version", () => {
    expect(FARM_VERSION).toBe(packageJson.version);
  });
});
