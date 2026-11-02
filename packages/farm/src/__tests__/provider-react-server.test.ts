import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
});

describe("FarmProvider", () => {
  it("imports where React has no createContext, as in the RSC engine's react-server build", async () => {
    // react-server's React: no client APIs.
    vi.doMock("react", () => ({ default: {} }));
    await expect(import("../provider")).resolves.toHaveProperty("FarmProvider");
  });

  it("still provides one context to its hooks", async () => {
    const { renderToString } = await import("react-dom/server");
    const React = await import("react");
    const { FarmProvider, useBasePath } = await import("../provider");
    function Base() {
      return React.createElement("span", null, useBasePath());
    }
    const html = renderToString(
      React.createElement(
        FarmProvider,
        { config: { basePath: "/console" } as never },
        React.createElement(Base),
      ),
    );
    expect(html).toBe("<span>/console</span>");
  });
});
