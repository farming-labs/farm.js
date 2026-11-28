// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compilerBenchmark, islandsBenchmark, jsFrameworkBenchmark } from "./runtime-benchmarks";

const compilerResults = JSON.parse(
  readFileSync(
    new URL("../../../benchmarks/compiler/results/latest.json", import.meta.url),
    "utf8",
  ),
) as Record<string, Record<string, { p50: number }>>;
const islandsDocs = readFileSync(
  new URL("../app/docs/server-rendering/islands/page.md", import.meta.url),
  "utf8",
);

/** The cells of one row of the islands docs' comparison table, after its label. */
function islandsRow(label: string) {
  const row = islandsDocs.split("\n").find((line) => line.startsWith(`| ${label} `));
  if (!row) throw new Error(`The islands docs table has no "${label}" row`);
  return row
    .split("|")
    .slice(2, -1)
    .map((cell) => cell.trim().split(" to ").map(Number.parseFloat));
}

describe("runtime benchmark figures", () => {
  it("match the checked-in compiler benchmark results", () => {
    const round = (value: number) => Math.round(value * 10) / 10;
    expect(round(compilerResults.baseline.swap.p50)).toBe(compilerBenchmark.swap.reactMs);
    expect(round(compilerResults.compiled.swap.p50)).toBe(compilerBenchmark.swap.compiledMs);
  });

  it("match the islands docs' comparison table", () => {
    const firstLoad = islandsRow("First-load JavaScript");
    expect(firstLoad).toEqual(
      firstLoad.map(() => [islandsBenchmark.firstLoadKb.rsc, islandsBenchmark.firstLoadKb.islands]),
    );
    expect(islandsRow("First-load main thread")).toEqual(
      islandsBenchmark.mainThreadMs.map(({ rsc, islands }) => [rsc, islands]),
    );
    expect(islandsRow("Server requests per second")[2]).toEqual([
      islandsBenchmark.blogRequestsPerSecond.rsc,
      islandsBenchmark.blogRequestsPerSecond.islands,
    ]);
  });

  it("list the js-framework-benchmark entries from fastest to slowest", () => {
    const scores = jsFrameworkBenchmark.entries.map((entry) => entry.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
  });

  it("back the page's claim that Farm.js is the fastest React entry", () => {
    const score = (id: string) =>
      jsFrameworkBenchmark.entries.find((entry) => entry.id === id)!.score;
    const react = jsFrameworkBenchmark.entries.filter((entry) => entry.id.startsWith("react"));
    expect(react.length).toBeGreaterThan(0);
    for (const entry of react) expect(score("farm-react")).toBeLessThan(entry.score);
  });
});
