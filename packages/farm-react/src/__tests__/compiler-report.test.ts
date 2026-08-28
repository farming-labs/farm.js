// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createReactCompilerReport,
  writeReactCompilerReport,
  type ReactCompilerModuleObservation,
} from "../compiler-report";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function observations(projectRoot: string): ReactCompilerModuleObservation[] {
  return [
    {
      id: join(projectRoot, "src", "Counter.tsx"),
      result: {
        compiled: ["Counter"],
        diagnostics: [],
        optimizations: {
          keyedArrayAppendHints: 0,
          keyedArrayFilterHints: 0,
          keyedArrayPrependHints: 0,
          keyedCollectionUpdateHints: 0,
          keyedIdentityTargets: 0,
          keyedMapLookupTargets: 0,
          keyedMembershipTargets: 0,
          keyedMapUpdateHints: 0,
        },
      },
    },
    {
      id: join(projectRoot, "src", "Lists.tsx"),
      result: {
        compiled: ["Row"],
        diagnostics: [
          {
            component: "List",
            reason: "dynamic child structures require React reconciliation",
            selected: false,
          },
          {
            component: "Grid",
            reason: "dynamic child structures require React reconciliation",
            selected: true,
          },
        ],
        optimizations: {
          keyedArrayAppendHints: 4,
          keyedArrayFilterHints: 3,
          keyedArrayPrependHints: 2,
          keyedCollectionUpdateHints: 6,
          keyedIdentityTargets: 4,
          keyedMapLookupTargets: 5,
          keyedMembershipTargets: 2,
          keyedMapUpdateHints: 3,
        },
      },
    },
  ];
}

describe("React compiler coverage report", () => {
  it("summarizes compiled components and fallback reasons deterministically", () => {
    const projectRoot = "/workspace/app";
    const report = createReactCompilerReport(projectRoot, observations(projectRoot));

    expect(report.summary).toEqual({
      modules: 2,
      componentsConsidered: 4,
      compiled: 2,
      fallback: 2,
      keyedArrayAppendHints: 4,
      keyedArrayFilterHints: 3,
      keyedArrayPrependHints: 2,
      keyedCollectionUpdateHints: 6,
      keyedIdentityTargets: 4,
      keyedMapLookupTargets: 5,
      keyedMembershipTargets: 2,
      keyedMapUpdateHints: 3,
    });
    expect(report.fallbackReasons).toEqual([
      {
        count: 2,
        reason: "dynamic child structures require React reconciliation",
      },
    ]);
    expect(report.modules.map((module) => module.id)).toEqual(["src/Counter.tsx", "src/Lists.tsx"]);
    expect(report.modules[1]?.fallbacks[1]).toEqual({
      module: "src/Lists.tsx",
      component: "Grid",
      reason: "dynamic child structures require React reconciliation",
      selected: true,
    });
    expect(report.modules[1]?.optimizations).toEqual({
      keyedArrayAppendHints: 4,
      keyedArrayFilterHints: 3,
      keyedArrayPrependHints: 2,
      keyedCollectionUpdateHints: 6,
      keyedIdentityTargets: 4,
      keyedMapLookupTargets: 5,
      keyedMembershipTargets: 2,
      keyedMapUpdateHints: 3,
    });
  });

  it("writes formatted JSON to the configured project-relative file", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "farm-react-report-"));
    temporaryDirectories.push(projectRoot);
    const outputPath = await writeReactCompilerReport(
      projectRoot,
      ".farm/react-compiler.json",
      observations(projectRoot),
    );
    const report = JSON.parse(await readFile(outputPath, "utf8"));

    expect(outputPath).toBe(join(projectRoot, ".farm", "react-compiler.json"));
    expect(report.version).toBe(1);
    expect(report.summary.compiled).toBe(2);
  });
});
