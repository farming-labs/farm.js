// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFarmProductionVite } from "../build/production-vite";

const viteMocks = vi.hoisted(() => ({
  build: vi.fn(),
  createServer: vi.fn(),
  loadEnv: vi.fn(),
}));

vi.mock("vite", () => ({
  build: viteMocks.build,
  createServer: viteMocks.createServer,
  loadEnv: viteMocks.loadEnv,
}));

const originalBuilder = process.env.FARM_VITE_BUILDER;

function restoreEnvironment(): void {
  if (originalBuilder === undefined) {
    delete process.env.FARM_VITE_BUILDER;
  } else {
    process.env.FARM_VITE_BUILDER = originalBuilder;
  }
}

beforeEach(restoreEnvironment);
afterEach(restoreEnvironment);

describe("production Vite selection", { concurrent: false }, () => {
  const rolldownRuntime = {
    build: viteMocks.build,
    createServer: viteMocks.createServer,
    loadEnv: viteMocks.loadEnv,
    builder: "rolldown",
  };

  it("loads Vite's Rolldown runtime by default", async () => {
    delete process.env.FARM_VITE_BUILDER;

    await expect(loadFarmProductionVite()).resolves.toEqual(rolldownRuntime);
  });

  it("accepts an explicit Rolldown request", async () => {
    process.env.FARM_VITE_BUILDER = " Rolldown ";

    await expect(loadFarmProductionVite()).resolves.toEqual(rolldownRuntime);
  });

  it("explains that the Rollup builder was removed", async () => {
    process.env.FARM_VITE_BUILDER = "rollup";

    await expect(loadFarmProductionVite()).rejects.toThrow(
      "FARM_VITE_BUILDER=rollup is no longer supported",
    );
  });

  it("rejects an invalid FARM_VITE_BUILDER value", async () => {
    process.env.FARM_VITE_BUILDER = "webpack";

    await expect(loadFarmProductionVite()).rejects.toThrow(
      'FARM_VITE_BUILDER must be "rolldown" when set',
    );
  });
});
