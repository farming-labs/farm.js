import { describe, expect, it, vi } from "vitest";
import { invalidateFileModules } from "./module-graph.js";

describe("invalidateFileModules", () => {
  it("looks a Windows path up by the forward-slash key Vite's module graph uses", () => {
    const generated = {};
    // Vite keys files by normalizePath(id): forward slashes on every platform.
    const modulesByFile = new Map([["C:/app/.farm/content/server.mjs", new Set([generated])]]);
    const invalidateModule = vi.fn();

    invalidateFileModules(
      { getModulesByFile: (file) => modulesByFile.get(file), invalidateModule },
      "C:\\app\\.farm\\content\\server.mjs",
    );

    expect(invalidateModule).toHaveBeenCalledExactlyOnceWith(generated);
  });

  it("leaves POSIX paths unchanged and tolerates a graph without getModulesByFile", () => {
    const getModulesByFile = vi.fn(() => undefined);
    const invalidateModule = vi.fn();

    invalidateFileModules({ getModulesByFile, invalidateModule }, "/app/.farm/content/server.mjs");
    invalidateFileModules({ invalidateModule }, "/app/.farm/content/server.mjs");

    expect(getModulesByFile).toHaveBeenCalledWith("/app/.farm/content/server.mjs");
    expect(invalidateModule).not.toHaveBeenCalled();
  });
});
