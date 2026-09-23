export function readBenchmarkOptions(env = process.env) {
  function integer(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new TypeError(
        `${name} must be a safe integer between ${min} and ${max}; received ${JSON.stringify(raw)}.`,
      );
    }
    return value;
  }

  return {
    dashboardSamples: integer("FARM_DASHBOARD_SAMPLES", 60),
    dashboardUpdatesPerSample: integer("FARM_DASHBOARD_UPDATES", 10),
    tableSamples: integer("FARM_TABLE_SAMPLES", 10),
    warmupSamples: integer("FARM_BENCHMARK_WARMUP", 5, 0),
    scaleCycles: integer("FARM_SCALE_CYCLES", 3),
    // The four isolated trials use basePort through basePort + 3.
    basePort: integer("FARM_DASHBOARD_PORT", 4380, 1, 65532),
  };
}
