import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { resolveFarmServerComponentsMode } from "../server-components-mode";

describe("experimental.serverComponents mode", () => {
  it("maps true to rsc and reads the object form", () => {
    expect(resolveFarmServerComponentsMode(undefined)).toBeUndefined();
    expect(resolveFarmServerComponentsMode(false)).toBeUndefined();
    expect(resolveFarmServerComponentsMode(true)).toBe("rsc");
    expect(resolveFarmServerComponentsMode({ mode: "rsc" })).toBe("rsc");
    expect(resolveFarmServerComponentsMode({ mode: "islands" })).toBe("islands");
  });

  it("rejects an unknown mode instead of ignoring it", async () => {
    for (const value of [{ mode: "flight" }, {}, "rsc"]) {
      expect(() => resolveFarmServerComponentsMode(value)).toThrow(
        'experimental.serverComponents must be true, false, { mode: "rsc" } or { mode: "islands" }.',
      );
    }
    await expect(
      resolveConfig(
        { experimental: { serverComponents: { mode: "flight" } as never } },
        "production",
      ),
    ).rejects.toThrow('{ mode: "islands" }');
  });
});
