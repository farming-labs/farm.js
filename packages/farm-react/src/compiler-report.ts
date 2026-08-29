import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import type { CompileReactModuleResult, CompilerDiagnostic } from "./compiler";

export interface ReactCompilerModuleObservation {
  id: string;
  result: Pick<CompileReactModuleResult, "compiled" | "diagnostics" | "optimizations">;
}

export interface ReactCompilerReportFallback extends CompilerDiagnostic {
  module: string;
}

export interface ReactCompilerReport {
  version: 1;
  summary: {
    modules: number;
    componentsConsidered: number;
    compiled: number;
    fallback: number;
    keyedArrayAppendHints: number;
    keyedArrayFilterHints: number;
    keyedArrayPrependHints: number;
    keyedArrayPositionHints: number;
    keyedArrayReorderHints: number;
    keyedArrayRollingWindowHints: number;
    keyedArraySliceHints: number;
    keyedCollectionUpdateHints: number;
    keyedIdentityTargets: number;
    keyedMapLookupTargets: number;
    keyedMembershipTargets: number;
    keyedMapUpdateHints: number;
  };
  fallbackReasons: Array<{
    count: number;
    reason: string;
  }>;
  modules: Array<{
    id: string;
    compiled: readonly string[];
    optimizations: {
      keyedArrayAppendHints: number;
      keyedArrayFilterHints: number;
      keyedArrayPrependHints: number;
      keyedArrayPositionHints: number;
      keyedArrayReorderHints: number;
      keyedArrayRollingWindowHints: number;
      keyedArraySliceHints: number;
      keyedCollectionUpdateHints: number;
      keyedIdentityTargets: number;
      keyedMapLookupTargets: number;
      keyedMembershipTargets: number;
      keyedMapUpdateHints: number;
    };
    fallbacks: ReactCompilerReportFallback[];
  }>;
}

function projectRelativeId(projectRoot: string, id: string): string {
  return relative(projectRoot, id).replace(/\\/g, "/");
}

export function createReactCompilerReport(
  projectRoot: string,
  observations: Iterable<ReactCompilerModuleObservation>,
): ReactCompilerReport {
  const reasonCounts = new Map<string, number>();
  let componentsConsidered = 0;
  let compiled = 0;
  let fallback = 0;
  let keyedArrayAppendHints = 0;
  let keyedArrayFilterHints = 0;
  let keyedArrayPrependHints = 0;
  let keyedArrayPositionHints = 0;
  let keyedArrayReorderHints = 0;
  let keyedArrayRollingWindowHints = 0;
  let keyedArraySliceHints = 0;
  let keyedCollectionUpdateHints = 0;
  let keyedIdentityTargets = 0;
  let keyedMapLookupTargets = 0;
  let keyedMembershipTargets = 0;
  let keyedMapUpdateHints = 0;

  const modules = [...observations]
    .map(({ id, result }) => {
      componentsConsidered += result.compiled.length + result.diagnostics.length;
      compiled += result.compiled.length;
      fallback += result.diagnostics.length;
      keyedArrayAppendHints += result.optimizations.keyedArrayAppendHints || 0;
      keyedArrayFilterHints += result.optimizations.keyedArrayFilterHints || 0;
      keyedArrayPrependHints += result.optimizations.keyedArrayPrependHints || 0;
      keyedArrayPositionHints += result.optimizations.keyedArrayPositionHints || 0;
      keyedArrayReorderHints += result.optimizations.keyedArrayReorderHints || 0;
      keyedArrayRollingWindowHints += result.optimizations.keyedArrayRollingWindowHints || 0;
      keyedArraySliceHints += result.optimizations.keyedArraySliceHints || 0;
      keyedCollectionUpdateHints += result.optimizations.keyedCollectionUpdateHints || 0;
      keyedIdentityTargets += result.optimizations.keyedIdentityTargets || 0;
      keyedMapLookupTargets += result.optimizations.keyedMapLookupTargets || 0;
      keyedMembershipTargets += result.optimizations.keyedMembershipTargets || 0;
      keyedMapUpdateHints += result.optimizations.keyedMapUpdateHints;
      const moduleId = projectRelativeId(projectRoot, id);
      const fallbacks = result.diagnostics.map((diagnostic) => {
        reasonCounts.set(diagnostic.reason, (reasonCounts.get(diagnostic.reason) || 0) + 1);
        return { module: moduleId, ...diagnostic };
      });
      return {
        id: moduleId,
        compiled: [...result.compiled].sort(),
        optimizations: result.optimizations,
        fallbacks,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));

  const fallbackReasons = [...reasonCounts]
    .map(([reason, count]) => ({ count, reason }))
    .sort((left, right) => right.count - left.count || left.reason.localeCompare(right.reason));

  return {
    version: 1,
    summary: {
      modules: modules.length,
      componentsConsidered,
      compiled,
      fallback,
      keyedArrayAppendHints,
      keyedArrayFilterHints,
      keyedArrayPrependHints,
      keyedArrayPositionHints,
      keyedArrayReorderHints,
      keyedArrayRollingWindowHints,
      keyedArraySliceHints,
      keyedCollectionUpdateHints,
      keyedIdentityTargets,
      keyedMapLookupTargets,
      keyedMembershipTargets,
      keyedMapUpdateHints,
    },
    fallbackReasons,
    modules,
  };
}

export async function writeReactCompilerReport(
  projectRoot: string,
  reportFile: string,
  observations: Iterable<ReactCompilerModuleObservation>,
): Promise<string> {
  const outputPath = resolve(projectRoot, reportFile);
  const report = createReactCompilerReport(projectRoot, observations);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return outputPath;
}
