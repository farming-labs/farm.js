// @vitest-environment node

import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBenchmarkArtifacts } from "../../../../examples/react-compiler-dashboard/scripts/benchmark-artifacts.mjs";

let directory: string;
let reportPath: string;

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "farm-benchmark-artifacts-test-"));
  reportPath = path.join(directory, "report.json");
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

async function readJson(filename: string) {
  return JSON.parse(await fs.readFile(filename, "utf8"));
}

describe("compiler dashboard benchmark artifacts", () => {
  it("preflights the real runner before starting a browser or replacing build output", async () => {
    const runner = fileURLToPath(
      new URL(
        "../../../../examples/react-compiler-dashboard/scripts/benchmark.mjs",
        import.meta.url,
      ),
    );
    const invalidReport = path.join(directory, "missing", "report.json");
    await fs.mkdir(path.join(directory, ".farm"));
    const sentinel = path.join(directory, ".farm", "keep-me.txt");
    await fs.writeFile(sentinel, "existing build");
    await expect(
      promisify(execFile)(process.execPath, [runner], {
        cwd: directory,
        env: {
          ...process.env,
          // This case tests report preflight, not shell-provided numeric options.
          FARM_DASHBOARD_SAMPLES: "",
          FARM_DASHBOARD_UPDATES: "",
          FARM_TABLE_SAMPLES: "",
          FARM_BENCHMARK_WARMUP: "",
          FARM_SCALE_CYCLES: "",
          FARM_DASHBOARD_PORT: "",
          FARM_DASHBOARD_REPORT: invalidReport,
          FARM_EXPERIMENT_BROWSER_PATH: path.join(directory, "must-not-launch"),
        },
      }),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining(path.join(directory, "missing")),
      stdout: expect.not.stringContaining("[dashboard] building"),
    });
    expect(await fs.readFile(sentinel, "utf8")).toBe("existing build");
  });

  it("supports long report filenames without making the artifact directory name too long", async () => {
    const destination = path.join(directory, `${"r".repeat(230)}.json`);
    const artifacts = await createBenchmarkArtifacts(destination, {});
    await artifacts.complete({ status: "FAIL" });
    expect(await readJson(destination)).toEqual({ status: "FAIL" });
  });

  it("preserves the previous report until the complete report is published", async () => {
    const previous = '{"status":"PASS","run":"previous"}\n';
    await fs.writeFile(reportPath, previous);
    const artifacts = await createBenchmarkArtifacts(reportPath, { samples: 10 });
    const trial = { browserVersion: "test", result: { trial: "baseline-a", medianMs: 10 } };
    await artifacts.saveTrial(trial);

    expect(await fs.readFile(reportPath, "utf8")).toBe(previous);
    expect(await readJson(path.join(artifacts.directory, "run.json"))).toEqual({
      status: "INCOMPLETE",
      reportPath,
      metadata: { samples: 10 },
    });
    expect(await readJson(path.join(artifacts.directory, "trial-1.json"))).toEqual({
      status: "INCOMPLETE",
      trial,
    });

    // Failed gates must be published just as faithfully as passing gates.
    const report = { status: "FAIL", regressions: ["reverse"], samples: 10 };
    await artifacts.complete(report);
    expect(await readJson(reportPath)).toEqual(report);
    expect((await fs.readdir(artifacts.directory)).sort()).toEqual(["run.json", "trial-1.json"]);
  });

  it("does not create an aggregate report for interrupted trials", async () => {
    const artifacts = await createBenchmarkArtifacts(reportPath, {});
    await artifacts.saveTrial({ result: { trial: "baseline-a" } });
    await artifacts.saveTrial({ result: { trial: "static" } });
    await expect(fs.readFile(reportPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readJson(path.join(artifacts.directory, "trial-2.json"))).status).toBe(
      "INCOMPLETE",
    );
  });

  it("keeps checkpoints from different runs separate", async () => {
    const first = await createBenchmarkArtifacts(reportPath, { run: 1 });
    const second = await createBenchmarkArtifacts(reportPath, { run: 2 });
    expect(first.directory).not.toBe(second.directory);
    await first.saveTrial({ value: 1 });
    await second.saveTrial({ value: 2 });
    expect((await readJson(path.join(first.directory, "trial-1.json"))).trial.value).toBe(1);
    expect((await readJson(path.join(second.directory, "trial-1.json"))).trial.value).toBe(2);
  });

  it("rejects missing parent directories and non-file destinations before trial work", async () => {
    await expect(
      createBenchmarkArtifacts(path.join(directory, "missing", "report.json"), {}),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(createBenchmarkArtifacts(directory, {})).rejects.toThrow("must be a regular file");
    expect(await fs.readdir(directory)).toEqual([]);
  });

  it("propagates preflight write failure without changing an existing report", async () => {
    await fs.writeFile(reportPath, "previous report");
    const error = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    vi.spyOn(fs, "writeFile").mockRejectedValueOnce(error);
    await expect(createBenchmarkArtifacts(reportPath, {})).rejects.toBe(error);
    expect(await fs.readFile(reportPath, "utf8")).toBe("previous report");
  });

  it.each(["checkpoint", "final"] as const)(
    "preserves completed evidence when a %s write fails partway through",
    async (kind) => {
      await fs.writeFile(reportPath, "previous report");
      const artifacts = await createBenchmarkArtifacts(reportPath, {});
      await artifacts.saveTrial({ value: "first" });
      const originalWrite = fs.writeFile;
      const error = Object.assign(new Error("disk full"), { code: "ENOSPC" });
      vi.spyOn(fs, "writeFile").mockImplementationOnce(async (filename, _data, options) => {
        await originalWrite(filename, '{"truncated":', options);
        throw error;
      });
      await expect(
        kind === "checkpoint"
          ? artifacts.saveTrial({ value: "second" })
          : artifacts.complete({ status: "PASS" }),
      ).rejects.toBe(error);

      expect(await fs.readFile(reportPath, "utf8")).toBe("previous report");
      expect((await readJson(path.join(artifacts.directory, "trial-1.json"))).trial.value).toBe(
        "first",
      );
      await expect(
        fs.readFile(path.join(artifacts.directory, "trial-2.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      const pending = kind === "checkpoint" ? "trial-2.json.pending" : "report.json.pending";
      expect(await fs.readFile(path.join(artifacts.directory, pending), "utf8")).toBe(
        '{"truncated":',
      );
    },
  );

  it("keeps the old aggregate and checkpoint if final replacement fails", async () => {
    await fs.writeFile(reportPath, "previous report");
    const artifacts = await createBenchmarkArtifacts(reportPath, {});
    await artifacts.saveTrial({ value: "first" });
    const error = Object.assign(new Error("replacement denied"), { code: "EACCES" });
    vi.spyOn(fs, "rename").mockRejectedValueOnce(error);
    await expect(artifacts.complete({ status: "FAIL" })).rejects.toBe(error);
    expect(await fs.readFile(reportPath, "utf8")).toBe("previous report");
    expect(await readJson(path.join(artifacts.directory, "report.json.pending"))).toEqual({
      status: "FAIL",
    });
    expect((await readJson(path.join(artifacts.directory, "trial-1.json"))).status).toBe(
      "INCOMPLETE",
    );
  });
});
