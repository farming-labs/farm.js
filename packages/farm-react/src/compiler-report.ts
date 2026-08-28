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
    keyedIdentityTargets: number;
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
      keyedIdentityTargets: number;
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
  let keyedIdentityTargets = 0;
  let keyedMapUpdateHints = 0;

  const modules = [...observations]
    .map(({ id, result }) => {
      componentsConsidered += result.compiled.length + result.diagnostics.length;
      compiled += result.compiled.length;
      fallback += result.diagnostics.length;
      keyedIdentityTargets += result.optimizations.keyedIdentityTargets || 0;
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
      keyedIdentityTargets,
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
