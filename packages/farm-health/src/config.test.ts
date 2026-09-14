import { describe, expect, it, vi } from "vitest";
import { parseHealthDuration, resolveHealthOptions } from "./config";

describe("health config", () => {
  it("resolves concise checks, paths, and timeouts", () => {
    const database = vi.fn();
    const cache = vi.fn();
    const options = resolveHealthOptions({
      timeout: "2s",
      paths: { readiness: "/status/ready/" },
      checks: {
        database,
        cache: { check: cache, required: false, timeout: "250ms" },
      },
    });

    expect(options.paths).toEqual({
      liveness: "/health/live",
      readiness: "/status/ready",
      startup: "/health/startup",
    });
    expect(options.checks).toEqual([
      { name: "database", check: database, required: true, timeoutMs: 2_000 },
      { name: "cache", check: cache, required: false, timeoutMs: 250 },
    ]);
    expect(options.startupChecks).toEqual([]);
    expect(options.details).toBe(false);
  });

  it("parses supported duration forms", () => {
    expect(parseHealthDuration(20)).toBe(20);
    expect(parseHealthDuration("0.5s")).toBe(500);
    expect(parseHealthDuration("2m")).toBe(120_000);
    expect(parseHealthDuration("1h")).toBe(3_600_000);
  });

  it.each([
    [{ enabled: true }, "does not accept enabled"],
    [{ timeout: 0 }, "positive safe integer"],
    [{ timeout: null }, "must be milliseconds"],
    [{ timeout: "soon" }, "must be milliseconds"],
    [{ details: "yes" }, "details must be"],
    [{ paths: { liveness: "/" } }, "safe absolute pathname"],
    [{ paths: { liveness: "health/live" } }, "safe absolute pathname"],
    [{ paths: { liveness: "/health/%2fadmin" } }, "unsafe path segment"],
    [
      { paths: { liveness: "/same", readiness: "/same", startup: "/start" } },
      "paths must be different",
    ],
    [{ checks: { database: {} } }, "requires a check function"],
    [{ checks: { database: { check: () => true, required: "yes" } } }, "must be a boolean"],
    [
      { checks: { duplicate: () => true }, startupChecks: { duplicate: () => true } },
      "used in both",
    ],
  ] as const)("rejects invalid option %#", (options, message) => {
    expect(() => resolveHealthOptions(options as never)).toThrow(message);
  });
});
