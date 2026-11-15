import { describe, expect, it, vi } from "vitest";

// Vue, Svelte, Solid and Preact apps don't install React, so the entry the CLI loads must
// not reach it. Any import of React from this module graph now fails the test.
// (vi.mock is hoisted above any helper, so each factory throws inline.)
vi.mock("react", () => {
  throw new Error("React is not installed in this app");
});
vi.mock("react/jsx-runtime", () => {
  throw new Error("React is not installed in this app");
});
vi.mock("react-dom", () => {
  throw new Error("React is not installed in this app");
});
vi.mock("react-dom/server", () => {
  throw new Error("React is not installed in this app");
});
// islx's React side loads React from its own package, where the mocks above do not reach.
vi.mock("@farm.js/islx/react", () => {
  throw new Error("React is not installed in this app");
});
vi.mock("@farm.js/islx/react/server", () => {
  throw new Error("React is not installed in this app");
});

describe("@farm.js/core/internal/cli-runtime", () => {
  it("loads without React", async () => {
    const runtime = await import("../cli-runtime");
    expect(typeof runtime.loadConfig).toBe("function");
    expect(typeof runtime.logger.info).toBe("function");
  });

  // Islands mode renders on islx, which loads React: only an islands app may reach it.
  it("keeps the server entry and production runtime free of React", async () => {
    const server = await import("../server");
    const production = await import("../nitro/production-runtime");
    expect(typeof server.createServer).toBe("function");
    expect(typeof production.installFarmIslandValues).toBe("function");
  });
});
