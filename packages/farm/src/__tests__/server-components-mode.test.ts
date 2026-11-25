import { describe, expect, it } from "vitest";
import { resolveConfig } from "../config";
import { usesFarmRendererIslands } from "../renderer-islands";
import { resolveFarmServerComponentsMode } from "../server-components-mode";

describe("experimental.serverComponents mode", () => {
  it("maps true to islands and reads the object form", () => {
    expect(resolveFarmServerComponentsMode(undefined)).toBeUndefined();
    expect(resolveFarmServerComponentsMode(false)).toBeUndefined();
    expect(resolveFarmServerComponentsMode(true)).toBe("islands");
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

describe("experimental.serverComponents islands on another renderer", () => {
  const plain = {
    name: "plain",
    vite: "plain-renderer/vite",
    server: "plain-renderer/server",
    client: "plain-renderer/client",
  };
  const islands = { ...plain, capabilities: { islands: true } };

  it("turns on the renderer's islands, without Farm's engine", async () => {
    for (const serverComponents of [true, { mode: "islands" as const }]) {
      const config = await resolveConfig(
        { renderer: islands, experimental: { serverComponents } },
        "production",
      );
      expect(config.experimental.serverComponents).toBe(false);
      expect(config.experimental.isolatedClientHydration).toBe("enabled");
      expect(usesFarmRendererIslands(config)).toBe(true);
      // Resolving the resolved config again keeps it.
      expect(usesFarmRendererIslands(await resolveConfig(config, "production"))).toBe(true);
    }
  });

  it("refuses a renderer that doesn't declare capabilities.islands", async () => {
    await expect(
      resolveConfig({ renderer: plain, experimental: { serverComponents: true } }, "production"),
    ).rejects.toThrow(
      '`experimental.serverComponents: { mode: "islands" }` needs a renderer that supports ' +
        "islands, and `plain` doesn't declare `capabilities.islands`.",
    );
  });

  it("leaves React, rsc, and an app without pages as they were", async () => {
    const react = await resolveConfig(
      { experimental: { serverComponents: { mode: "islands" } } },
      "production",
    );
    expect(react.experimental.serverComponents).toEqual({ mode: "islands" });
    expect(react.experimental.isolatedClientHydration).toBe("enabled");
    expect(usesFarmRendererIslands(react)).toBe(false);

    const rsc = await resolveConfig(
      { renderer: plain, experimental: { serverComponents: { mode: "rsc" } } },
      "production",
    );
    expect(rsc.experimental.serverComponents).toEqual({ mode: "rsc" });

    const noPages = await resolveConfig(
      { renderer: false, experimental: { serverComponents: true } },
      "production",
    );
    expect(noPages.experimental.serverComponents).toBe(true);
  });
});
