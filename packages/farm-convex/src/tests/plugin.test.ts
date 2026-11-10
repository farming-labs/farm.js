import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createConvexPlugin } from "../dev.js";

describe("farm:convex plugin", () => {
  it("has no build hooks, so convex dev never runs during farm build", () => {
    const plugin = createConvexPlugin({
      dev: {},
      homes: {},
      functionsDirectory: "convex",
      extensions: [],
    });
    expect(plugin.build).toBeUndefined();
    expect(Object.keys(plugin.dev ?? {})).toEqual(["server"]);
  });

  it("closes cleanly when Farm shuts down before the plugin was set up", async () => {
    const plugin = createConvexPlugin({
      dev: {},
      homes: {},
      functionsDirectory: "convex",
      extensions: [],
    });
    const close = plugin.runtime?.close as (context: { state: undefined }) => void;
    expect(() => close({ state: undefined })).not.toThrow();
  });

  it("checks service homes while Farm reads its config", () => {
    const plugin = createConvexPlugin({
      dev: undefined,
      homes: {},
      functionsDirectory: "convex",
      extensions: [],
    });
    const root = mkdtempSync(path.join(tmpdir(), "farm-convex-plugin-"));
    const configure = plugin.configure as (config: object, context: object) => void;
    expect(() => configure({ root, integrations: {} }, {})).not.toThrow();
  });
});
