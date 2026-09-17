import fs from "node:fs/promises";
import path from "node:path";

// Checkpoints are diagnostic evidence only. The runner still has to finish every
// trial and evaluate its unchanged gates before publishing the aggregate report.
export async function createBenchmarkArtifacts(reportPath, metadata) {
  const destination = path.resolve(reportPath);
  const existing = await fs.lstat(destination).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  if (existing && !existing.isFile()) {
    throw new TypeError(`Benchmark report must be a regular file: ${destination}`);
  }

  // Creating and writing beside the report fails early for an unusable parent
  // directory and keeps staging on the same filesystem for atomic replacement.
  const directory = await fs.mkdtemp(path.join(path.dirname(destination), "farm-dashboard-run-"));
  async function publish(filename, value, target = path.join(directory, filename)) {
    const staging = path.join(directory, `${filename}.pending`);
    await fs.writeFile(staging, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    await fs.rename(staging, target);
  }
  await publish("run.json", { status: "INCOMPLETE", reportPath: destination, metadata });
  let completedTrials = 0;

  return {
    directory,
    // The runner calls this serially after closing each trial's browser/server,
    // never from inside a measured operation.
    async saveTrial(trial) {
      const number = completedTrials + 1;
      await publish(`trial-${number}.json`, { status: "INCOMPLETE", trial });
      completedTrials = number;
    },
    async complete(report) {
      // A failed write/rename leaves the previous final report and all completed
      // checkpoints untouched. Pending files are retained for diagnosis.
      await publish("report.json", report, destination);
    },
  };
}
