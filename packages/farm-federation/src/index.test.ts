import { beforeEach, describe, expect, it, vi } from "vitest";

const upstream = vi.hoisted(() => vi.fn(() => [{ name: "module-federation-vite" }]));

vi.mock("@module-federation/vite", () => ({ federation: upstream }));

import { federation } from "./index";

describe("federation plugin", () => {
  beforeEach(() => upstream.mockClear());

  it("adds client federation after existing Vite plugins", async () => {
    const plugin = federation({
      name: "storefront",
      remotes: { checkout: { entry: "https://checkout.example.com/mf-manifest.json" } },
    });
    const existing = { name: "existing" };
    const configured = await plugin.configure?.({
      root: "/app",
      renderer: { name: "react", dedupe: ["react", "react-dom"] },
      plugins: [plugin],
      vite: { plugins: [existing] },
    });

    expect(upstream).toHaveBeenCalledOnce();
    expect(configured?.vite?.plugins?.map((candidate) => candidate.name)).toEqual([
      "existing",
      "farm:federation:server-import-guard",
      "farm:federation:output-boundary",
      "module-federation-vite",
      "farm:federation:manifest",
    ]);
  });

  it("rejects multiple logical federation plugins", () => {
    const first = federation({ name: "first" });
    const second = federation({ name: "second" });
    expect(() =>
      first.configure?.({
        root: "/app",
        renderer: { name: "react", dedupe: ["react", "react-dom"] },
        plugins: [first, second],
        vite: {},
      }),
    ).toThrow("one federation() instance");
  });
});
