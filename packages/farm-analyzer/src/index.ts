import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { definePlugin } from "@farm.js/core/plugin";
import { analyzeBuild, evaluateLimits, formatBytes } from "./analyze.js";
import {
  resolveAnalyzerOptions,
  type AnalyzerLimitAction,
  type AnalyzerLimits,
  type AnalyzerMetric,
  type AnalyzerOptions,
  type AnalyzerSize,
} from "./config.js";
import { openReport } from "./open.js";
import { renderAnalyzerReport } from "./report.js";

export type {
  AnalyzeBuildOptions,
  AnalyzerAsset,
  AnalyzerAssetKind,
  AnalyzerBuildReport,
  AnalyzerLimitKind,
  AnalyzerLimitViolation,
  AnalyzerPage,
  AnalyzerSizes,
} from "./analyze.js";
export type { AnalyzerLimitAction, AnalyzerLimits, AnalyzerMetric, AnalyzerOptions, AnalyzerSize };

/**
 * Explain the final Farm client and server output and optionally enforce size limits.
 * With no options, the plugin writes `.farm/analyze.html` after each successful build.
 */
export function analyzer(options: AnalyzerOptions = {}) {
  const resolved = resolveAnalyzerOptions(options);

  return definePlugin({
    name: "farm:analyzer",

    build: {
      async after(result) {
        if (!resolved.enabled || !result.success) return;

        const outputDir = path.resolve(
          result.root,
          result.outputDir ?? path.join(result.distDir, ".output"),
        );
        const report = await analyzeBuild({
          root: result.root,
          distDir: result.distDir,
          outputDir,
          preset: result.preset,
          metric: resolved.metric,
        });
        const violations = evaluateLimits(report, resolved.limits);
        let htmlPath: string | undefined;

        if (resolved.output !== false) {
          htmlPath = await writeOutput(
            result.root,
            resolved.output,
            renderAnalyzerReport(report, violations),
          );
          console.info(`[farm:analyzer] Report written to ${displayPath(result.root, htmlPath)}`);
        }

        if (resolved.json !== false) {
          const jsonPath = await writeOutput(
            result.root,
            resolved.json,
            `${JSON.stringify(
              {
                ...report,
                limits: {
                  configured: resolved.limits,
                  violations,
                },
              },
              null,
              2,
            )}\n`,
          );
          console.info(`[farm:analyzer] JSON written to ${displayPath(result.root, jsonPath)}`);
        }

        if (resolved.open && htmlPath) {
          try {
            await openReport(htmlPath);
          } catch (error) {
            console.warn(`[farm:analyzer] Could not open the report: ${errorMessage(error)}`);
          }
        }

        if (violations.length > 0) {
          const message = formatViolations(violations);
          if (resolved.onLimit === "warn") console.warn(message);
          else throw new Error(message);
        }
      },
    },
  });
}

async function writeOutput(root: string, output: string, contents: string): Promise<string> {
  const file = path.resolve(root, output);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, contents, "utf8");
  return file;
}

function formatViolations(
  violations: Array<{
    kind: string;
    name: string;
    actual: number;
    limit: number;
    metric: AnalyzerMetric;
  }>,
): string {
  const details = violations.map(
    (violation) =>
      `  - ${violation.kind} ${violation.name}: ${formatBytes(violation.actual)} > ${formatBytes(violation.limit)} (${violation.metric})`,
  );
  return [
    `[farm:analyzer] ${violations.length} size limit${violations.length === 1 ? "" : "s"} exceeded:`,
    ...details,
  ].join("\n");
}

function displayPath(root: string, file: string): string {
  const relative = path.relative(root, file);
  return relative && !relative.startsWith("..") ? relative : file;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
