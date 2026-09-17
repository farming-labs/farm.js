// @vitest-environment node

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { readBenchmarkOptions } from "../../../../examples/react-compiler-dashboard/scripts/benchmark-options.mjs";

const variables = [
  "FARM_DASHBOARD_SAMPLES",
  "FARM_DASHBOARD_UPDATES",
  "FARM_TABLE_SAMPLES",
  "FARM_BENCHMARK_WARMUP",
  "FARM_SCALE_CYCLES",
  "FARM_DASHBOARD_PORT",
] as const;

describe("compiler dashboard benchmark options", () => {
  it("keeps the existing defaults for unset or empty options", () => {
    const defaults = {
      dashboardSamples: 60,
      dashboardUpdatesPerSample: 10,
      tableSamples: 10,
      warmupSamples: 5,
      scaleCycles: 3,
      basePort: 4380,
    };
    expect(readBenchmarkOptions({})).toEqual(defaults);
    expect(readBenchmarkOptions(Object.fromEntries(variables.map((name) => [name, ""])))).toEqual(
      defaults,
    );
  });

  it("preserves valid numeric overrides including explicit zero warmup", () => {
    expect(
      readBenchmarkOptions({
        FARM_DASHBOARD_SAMPLES: "120",
        FARM_DASHBOARD_UPDATES: "20",
        FARM_TABLE_SAMPLES: "30",
        FARM_BENCHMARK_WARMUP: "0",
        FARM_SCALE_CYCLES: "4",
        FARM_DASHBOARD_PORT: "5000",
      }),
    ).toEqual({
      dashboardSamples: 120,
      dashboardUpdatesPerSample: 20,
      tableSamples: 30,
      warmupSamples: 0,
      scaleCycles: 4,
      basePort: 5000,
    });
  });

  it.each([" 10 ", "1e1", "0xa", "10.0"])(
    "retains the existing Number conversion for valid integer spelling %j",
    (value) => {
      expect(readBenchmarkOptions({ FARM_TABLE_SAMPLES: value }).tableSamples).toBe(10);
    },
  );

  for (const name of variables) {
    it.each(["NaN", "Infinity", "-Infinity", "abc", "1.5", "-1", " ", "\t", "9007199254740992"])(
      `rejects invalid ${name}=%j with the option name`,
      (value) => {
        expect(() => readBenchmarkOptions({ [name]: value })).toThrow(
          `${name} must be a safe integer`,
        );
      },
    );
    if (name !== "FARM_BENCHMARK_WARMUP") {
      it(`rejects zero ${name}`, () => {
        expect(() => readBenchmarkOptions({ [name]: "0" })).toThrow(name);
      });
    }
  }

  it("accepts a single sample/update/cycle without silently increasing it", () => {
    expect(readBenchmarkOptions(Object.fromEntries(variables.map((name) => [name, "1"])))).toEqual({
      dashboardSamples: 1,
      dashboardUpdatesPerSample: 1,
      tableSamples: 1,
      warmupSamples: 1,
      scaleCycles: 1,
      basePort: 1,
    });
  });

  it("reserves all four valid TCP ports", () => {
    expect(readBenchmarkOptions({ FARM_DASHBOARD_PORT: "65532" }).basePort + 3).toBe(65535);
    for (const value of ["65533", "65535", "65536"]) {
      expect(() => readBenchmarkOptions({ FARM_DASHBOARD_PORT: value })).toThrow(
        "FARM_DASHBOARD_PORT must be a safe integer between 1 and 65532",
      );
    }
  });

  it.each([
    ["FARM_TABLE_SAMPLES", "NaN"],
    ["FARM_BENCHMARK_WARMUP", "-1"],
    ["FARM_DASHBOARD_PORT", "65533"],
  ])("rejects %s in the real runner before report/browser/build work", async (name, value) => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "farm-benchmark-options-test-"));
    try {
      const runner = fileURLToPath(
        new URL(
          "../../../../examples/react-compiler-dashboard/scripts/benchmark.mjs",
          import.meta.url,
        ),
      );
      const reportPath = path.join(directory, "report.json");
      await fs.writeFile(reportPath, '{"status":"PASS","run":"previous"}\n');
      await fs.mkdir(path.join(directory, ".farm"));
      const sentinel = path.join(directory, ".farm", "keep-me.txt");
      await fs.writeFile(sentinel, "existing build");
      const env = { ...process.env };
      for (const variable of variables) delete env[variable];
      env[name] = value;
      env.FARM_DASHBOARD_REPORT = reportPath;
      env.FARM_EXPERIMENT_BROWSER_PATH = path.join(directory, "must-not-launch");

      await expect(
        promisify(execFile)(process.execPath, [runner], { cwd: directory, env }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(`${name} must be a safe integer`),
        stdout: expect.not.stringContaining("[dashboard]"),
      });
      expect(await fs.readFile(reportPath, "utf8")).toBe('{"status":"PASS","run":"previous"}\n');
      expect(await fs.readFile(sentinel, "utf8")).toBe("existing build");
      expect((await fs.readdir(directory)).sort()).toEqual([".farm", "report.json"]);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});
