// @vitest-environment node

import { describe, expect, it } from "vitest";
import { assertFarmDocsRuntimeSupported } from "../nitro/universal-build";

const withDocs = { docs: { enabled: true } } as Parameters<
  typeof assertFarmDocsRuntimeSupported
>[0];
const withoutDocs = { docs: { enabled: false } } as Parameters<
  typeof assertFarmDocsRuntimeSupported
>[0];
const withAdapter = {
  docs: {
    enabled: true,
    adapter: {
      id: "test-docs-adapter",
      protocol: 1,
      server: "test-docs-adapter/server",
      react: "test-docs-adapter/react",
    },
  },
} as Parameters<typeof assertFarmDocsRuntimeSupported>[0];

describe("docs engine deployment runtime", () => {
  it("allows the embedded renderer on edge presets", () => {
    for (const preset of ["cloudflare-pages", "cloudflare-module", "vercel-edge", "netlify-edge"]) {
      expect(() => assertFarmDocsRuntimeSupported(withDocs, preset)).not.toThrow();
    }
  });

  it("keeps unversioned adapter runtime behavior off edge targets", () => {
    for (const preset of ["cloudflare-pages", "cloudflare-module", "vercel-edge", "netlify-edge"]) {
      expect(() => assertFarmDocsRuntimeSupported(withAdapter, preset)).toThrow(
        new RegExp(`docs adapter .* "${preset}" preset deploys to an edge runtime`),
      );
    }
  });

  it("allows Node presets", () => {
    for (const preset of ["node-server", "vercel", "netlify"]) {
      expect(() => assertFarmDocsRuntimeSupported(withDocs, preset)).not.toThrow();
    }
  });

  it("does not affect apps without docs", () => {
    expect(() => assertFarmDocsRuntimeSupported(withoutDocs, "cloudflare-pages")).not.toThrow();
    expect(() =>
      assertFarmDocsRuntimeSupported({ docs: undefined } as never, "vercel-edge"),
    ).not.toThrow();
  });
});
