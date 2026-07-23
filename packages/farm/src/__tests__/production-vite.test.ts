// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canUseRolldownForRouteDiscovery,
  loadFarmProductionVite,
  supportsRolldownVite,
} from "../build/production-vite";

const viteMocks = vi.hoisted(() => ({
  rollupBuild: vi.fn(),
  rollupCreateServer: vi.fn(),
  rollupLoadEnv: vi.fn(),
  rolldownBuild: vi.fn(),
  rolldownCreateServer: vi.fn(),
  rolldownLoadEnv: vi.fn(),
}));

vi.mock("vite", () => ({
  build: viteMocks.rollupBuild,
  createServer: viteMocks.rollupCreateServer,
  loadEnv: viteMocks.rollupLoadEnv,
}));
vi.mock("vite-rolldown", () => ({
  build: viteMocks.rolldownBuild,
  createServer: viteMocks.rolldownCreateServer,
  loadEnv: viteMocks.rolldownLoadEnv,
}));

const originalBuilder = process.env.FARM_VITE_BUILDER;
const originalNodeVersion = Object.getOwnPropertyDescriptor(process.versions, "node");

function restoreEnvironment(): void {
  if (originalBuilder === undefined) {
    delete process.env.FARM_VITE_BUILDER;
  } else {
    process.env.FARM_VITE_BUILDER = originalBuilder;
  }

  if (originalNodeVersion) {
    Object.defineProperty(process.versions, "node", originalNodeVersion);
  }
}

function useNodeVersion(version: string): void {
  Object.defineProperty(process.versions, "node", {
    ...originalNodeVersion,
    configurable: true,
    value: version,
  });
}

beforeEach(restoreEnvironment);
afterEach(restoreEnvironment);

describe.sequential("production Vite selection", () => {
  it("keeps custom Vite configuration on the compatibility discovery server", () => {
    expect(canUseRolldownForRouteDiscovery(undefined)).toBe(true);
    expect(canUseRolldownForRouteDiscovery({})).toBe(true);
    expect(canUseRolldownForRouteDiscovery({ plugins: [] })).toBe(false);
    expect(canUseRolldownForRouteDiscovery({ resolve: { alias: {} } })).toBe(false);
  });

  it.each([
    ["18.20.8", false],
    ["20.18.3", false],
    ["20.19.0", true],
    ["21.7.3", false],
    ["22.11.0", false],
    ["22.12.0", true],
    ["23.0.0", true],
    ["24.1.0", true],
  ])("reports Node %s Rolldown support as %s", (version, supported) => {
    expect(supportsRolldownVite(version)).toBe(supported);
  });

  it("rejects an invalid FARM_VITE_BUILDER value", async () => {
    process.env.FARM_VITE_BUILDER = "webpack";

    await expect(loadFarmProductionVite()).rejects.toThrow(
      'FARM_VITE_BUILDER must be either "rolldown" or "rollup"',
    );
  });

  it("loads the Rollup runtime when explicitly requested", async () => {
    process.env.FARM_VITE_BUILDER = "rollup";

    await expect(loadFarmProductionVite()).resolves.toEqual({
      build: viteMocks.rollupBuild,
      createServer: viteMocks.rollupCreateServer,
      loadEnv: viteMocks.rollupLoadEnv,
      builder: "rollup",
    });
  });

  it("falls back to Rollup by default on an unsupported Node release", async () => {
    useNodeVersion("20.18.3");
    delete process.env.FARM_VITE_BUILDER;

    await expect(loadFarmProductionVite()).resolves.toEqual({
      build: viteMocks.rollupBuild,
      createServer: viteMocks.rollupCreateServer,
      loadEnv: viteMocks.rollupLoadEnv,
      builder: "rollup",
    });
  });

  it("rejects an explicit Rolldown request on an unsupported Node release", async () => {
    useNodeVersion("22.11.0");
    process.env.FARM_VITE_BUILDER = "rolldown";

    await expect(loadFarmProductionVite()).rejects.toThrow(
      "FARM_VITE_BUILDER=rolldown requires Node 20.19+, Node 22.12+, or a newer release",
    );
  });

  it("loads the Rolldown runtime on a supported Node release", async () => {
    useNodeVersion("22.12.0");
    process.env.FARM_VITE_BUILDER = "rolldown";

    await expect(loadFarmProductionVite()).resolves.toEqual({
      build: viteMocks.rolldownBuild,
      createServer: viteMocks.rolldownCreateServer,
      loadEnv: viteMocks.rolldownLoadEnv,
      builder: "rolldown",
    });
  });
});
