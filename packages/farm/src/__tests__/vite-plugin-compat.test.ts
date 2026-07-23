// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { adaptTailwindVitePlugin } from "../build/vite-plugin-compat";

describe("Vite production plugin compatibility", () => {
  it("keeps plugins unchanged for the Rollup compatibility builder", () => {
    const plugin = { name: "@tailwindcss/vite:generate:build", transform: vi.fn() };

    expect(adaptTailwindVitePlugin(plugin, "rollup")).toBe(plugin);
  });

  it("keeps unrelated Rolldown plugins unchanged", () => {
    const plugin = { name: "example", transform: vi.fn() };

    expect(adaptTailwindVitePlugin(plugin, "rolldown")).toBe(plugin);
  });

  it("uses Tailwind's Vite 5 transform path under Rolldown", async () => {
    const addWatchFile = vi.fn();
    const handler = vi.fn(
      function (this: { environment?: unknown; addWatchFile: (id: string) => void }) {
        this.addWatchFile("styles.css");
        return this.environment;
      },
    );
    const plugin = {
      name: "@tailwindcss/vite:generate:build",
      transform: { filter: { id: /\\.css$/ }, handler },
    };
    const [adapted] = adaptTailwindVitePlugin([plugin], "rolldown");

    const result = await adapted.transform.handler.call({
      environment: { name: "client" },
      addWatchFile,
    });

    expect(result).toBeUndefined();
    expect(addWatchFile).toHaveBeenCalledWith("styles.css");
    expect(adapted.transform.filter).toBe(plugin.transform.filter);
  });
});
