import { frameworkBenchmarkReport } from "./benchmark-results.generated";

export const benchmarkReport = frameworkBenchmarkReport;

const farmResult = benchmarkReport.frameworks.find((framework) => framework.id === "farm");

if (!farmResult) {
  throw new Error("The published framework benchmark is missing the Farm.js result");
}

export const farmBenchmark = farmResult;

export function formatBenchmarkDuration(milliseconds: number) {
  if (milliseconds >= 1000) {
    return (milliseconds / 1000).toFixed(2) + "s";
  }

  if (milliseconds < 10) {
    return milliseconds.toFixed(2) + "ms";
  }

  return Math.round(milliseconds) + "ms";
}
