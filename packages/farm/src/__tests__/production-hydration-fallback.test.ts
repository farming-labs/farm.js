// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { generateClientHydrationEntry } from "../nitro/universal-build";
import { defineRenderer, type FarmRenderer } from "../renderer";

// The production client entry is emitted as a template literal, so these tests run the emitted
// hydrateFarmRoute() against a stub renderer whose hydrateRoot() throws.

const page = {
  pattern: "/",
  modulePath: "/app/src/app/page.tsx",
  relativePath: "page.tsx",
  pageShouldHydrate: true,
  islandStrategy: "load" as const,
  hasIsolatedClientBoundaries: false,
  isolatedBoundaries: [],
};

function customRenderer(capabilities: FarmRenderer["capabilities"] = {}) {
  return defineRenderer({
    name: "custom",
    vite: "custom/vite",
    server: "custom/server",
    client: "custom/client",
    capabilities,
  });
}

function productionEntry(renderer?: FarmRenderer): string {
  return generateClientHydrationEntry(
    [page],
    [],
    [],
    "/app",
    "src",
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    renderer,
  );
}

function extractFunction(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Unterminated function: ${signature}`);
}

function hydrateWithThrowingRenderer(entry: string) {
  const error = new Error("The first browser render threw.");
  const clientRoot = { render: vi.fn(), unmount: vi.fn() };
  const runtime = {
    hydrateRoot: vi.fn(() => {
      throw error;
    }),
    createRoot: vi.fn(() => clientRoot),
    console: { error: vi.fn() },
  };
  const hydrateFarmRoute = new Function(
    "hydrateRoot",
    "createRoot",
    "console",
    [
      "let farmLastRouteState;",
      extractFunction(entry, "function hydrateFarmRoute("),
      extractFunction(entry, "function renderFarmRoute("),
      "return hydrateFarmRoute;",
    ].join("\n"),
  )(runtime.hydrateRoot, runtime.createRoot, runtime.console);
  const container = {};
  const route = { element: "page tree", layouts: [] };
  return { error, clientRoot, runtime, container, route, hydrateFarmRoute };
}

describe("a production page whose hydrateRoot() throws", () => {
  it("is left to the page when the renderer does not set capabilities.hydrationFallback", () => {
    for (const renderer of [
      undefined,
      customRenderer(),
      customRenderer({ hydrationFallback: false }),
    ]) {
      const entry = productionEntry(renderer);
      expect(entry).not.toContain("Hydration error; rendering the page on the client instead");
      const { error, runtime, container, route, hydrateFarmRoute } =
        hydrateWithThrowingRenderer(entry);
      expect(() => hydrateFarmRoute(container, route)).toThrow(error);
      expect(runtime.createRoot).not.toHaveBeenCalled();
    }
  });

  it("is rendered with createRoot() when the renderer sets capabilities.hydrationFallback", () => {
    const entry = productionEntry(customRenderer({ hydrationFallback: true }));
    const { error, clientRoot, runtime, container, route, hydrateFarmRoute } =
      hydrateWithThrowingRenderer(entry);

    expect(hydrateFarmRoute(container, route)).toBe(clientRoot);
    expect(runtime.createRoot).toHaveBeenCalledWith(container);
    expect(clientRoot.render).toHaveBeenCalledWith("page tree");
    expect(runtime.console.error).toHaveBeenCalledWith(
      "[Farm.js] Hydration error; rendering the page on the client instead:",
      error,
    );
  });
});
