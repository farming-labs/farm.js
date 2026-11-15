import { describe, expect, it } from "vitest";
import { resolveScrollRestorationOptions } from "./config.js";

describe("resolveScrollRestorationOptions", () => {
  it("fills the defaults when no options are given", () => {
    expect(resolveScrollRestorationOptions({})).toEqual({
      storageKeyPrefix: "farm-scroll-restore",
    });
  });

  it("keeps a custom prefix", () => {
    expect(resolveScrollRestorationOptions({ storageKeyPrefix: "my-app-scroll" })).toEqual({
      storageKeyPrefix: "my-app-scroll",
    });
  });

  it("rejects a non-object, an unknown key, or a bad prefix", () => {
    expect(() => resolveScrollRestorationOptions(null as never)).toThrow("must be an object");
    expect(() => resolveScrollRestorationOptions([] as never)).toThrow("must be an object");
    expect(() => resolveScrollRestorationOptions({ unknown: true } as never)).toThrow(
      'does not accept option "unknown"',
    );
    expect(() => resolveScrollRestorationOptions({ storageKeyPrefix: "" })).toThrow(
      "non-empty string",
    );
    expect(() => resolveScrollRestorationOptions({ storageKeyPrefix: 42 } as never)).toThrow(
      "non-empty string",
    );
  });
});
