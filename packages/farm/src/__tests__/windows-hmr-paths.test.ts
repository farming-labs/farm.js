// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { farmApiPlugin } from "../api/vite-plugin";
import { farmPlugin } from "../vite";

const { existsSync } = vi.hoisted(() => ({ existsSync: vi.fn() }));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  existsSync.mockImplementation(actual.existsSync);
  return { ...actual, existsSync };
});

describe("Windows HMR paths", () => {
  it("reloads page modules through the main Farm plugin", async () => {
    const send = vi.fn();
    const invalidateModule = vi.fn();
    const plugin = farmPlugin() as any;
    const module = { id: "C:\\project\\src\\app\\page.tsx" };

    const result = await plugin.handleHotUpdate({
      file: "C:\\project\\src\\app\\page.tsx",
      modules: [module],
      server: {
        moduleGraph: {
          getModuleById: vi.fn(() => null),
          invalidateModule,
        },
        ws: { send },
      },
    });

    expect(result).toEqual([]);
    expect(invalidateModule).toHaveBeenCalledWith(module);
    expect(send).toHaveBeenCalledWith({ type: "full-reload", path: "*" });
  });

  it("recognizes root route files through the standalone API plugin", async () => {
    const ssrLoadModule = vi.fn(async () => ({
      health: {
        __path: "/api/health",
        __method: "GET",
        handler: async () => new Response("ok"),
      },
    }));
    const plugin = farmApiPlugin() as any;

    const result = await plugin.handleHotUpdate({
      file: "C:\\project\\src\\routes.ts",
      modules: [],
      server: {
        moduleGraph: { invalidateModule: vi.fn() },
        ssrLoadModule,
      },
    });

    expect(result).toEqual([]);
    expect(ssrLoadModule).toHaveBeenCalledWith("C:\\project\\src\\routes.ts");
  });

  it("recognizes file-based API routes through the standalone plugin", async () => {
    existsSync.mockReturnValueOnce(true);
    const ssrLoadModule = vi.fn(async () => ({ GET: async () => new Response("ok") }));
    const plugin = farmApiPlugin() as any;

    const result = await plugin.handleHotUpdate({
      file: "C:\\project\\src\\api\\users\\route.ts",
      modules: [],
      server: {
        config: { root: "C:\\project" },
        moduleGraph: { invalidateModule: vi.fn() },
        ssrLoadModule,
      },
    });

    expect(result).toEqual([]);
    expect(ssrLoadModule).toHaveBeenCalledWith("C:\\project\\src\\api\\users\\route.ts");
  });
});
