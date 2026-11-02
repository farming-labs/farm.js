/**
 * `.farm/output/mobile/native-report.json` and its terminal table: what each route shows, and
 * for routes the analyzer looked at, whether it could become a native screen and why not.
 */
import type {
  FarmMobileNativeAuto,
  FarmMobileNativeEngine,
  FarmMobileOS,
  FarmMobileScreen,
} from "./config";
import type { FarmMobileAnalyzerStats, FarmMobileRouteAnalysis } from "./analyzer";
import type { FarmMobileScreenDecision, FarmMobileScreenSource } from "./screens";

export interface FarmMobileNativeReportRoute {
  route: string;
  /** What `farm-routes.json` shows for the route. */
  screen: FarmMobileScreen;
  source: FarmMobileScreenSource;
  requested?: Exclude<FarmMobileScreen, "web">;
  /** The page export or screen file that decided, app-root-relative. */
  file?: string;
  /** Present when the analyzer looked at the route. */
  analysis?: Omit<FarmMobileRouteAnalysis, "route">;
}

export interface FarmMobileNativeReport {
  version: 1;
  os: FarmMobileOS;
  engine: FarmMobileNativeEngine;
  auto: FarmMobileNativeAuto;
  summary: {
    routes: number;
    analyzed: number;
    /** Portable, and native would help. */
    port: number;
    /** Portable, but nothing native would improve. */
    portableNoWin: number;
    /** Analyzed and blocked. */
    blocked: number;
    /** Native or platform screens from files or config. */
    native: number;
  };
  routes: FarmMobileNativeReportRoute[];
}

export function createFarmMobileNativeReport(options: {
  os: FarmMobileOS;
  engine: FarmMobileNativeEngine;
  auto: FarmMobileNativeAuto;
  routes: readonly string[];
  screens: Readonly<Record<string, FarmMobileScreenDecision>>;
  analysis: Readonly<Record<string, FarmMobileRouteAnalysis>>;
}): FarmMobileNativeReport {
  const summary = { routes: 0, analyzed: 0, port: 0, portableNoWin: 0, blocked: 0, native: 0 };
  const routes = options.routes.map((route): FarmMobileNativeReportRoute => {
    const decision = options.screens[route]!;
    const analyzed = options.analysis[route];
    summary.routes += 1;
    if (decision.screen !== "web") summary.native += 1;
    if (analyzed) {
      summary.analyzed += 1;
      if (analyzed.decision === "port") summary.port += 1;
      else if (analyzed.portable) summary.portableNoWin += 1;
      else summary.blocked += 1;
    }
    const { route: _route, ...analysis } = analyzed ?? ({} as FarmMobileRouteAnalysis);
    return {
      route,
      screen: decision.screen,
      source: decision.source,
      ...(decision.requested ? { requested: decision.requested } : {}),
      ...(decision.file ? { file: decision.file } : {}),
      ...(analyzed ? { analysis } : {}),
    };
  });
  return {
    version: 1,
    os: options.os,
    engine: options.engine,
    auto: options.auto,
    summary,
    routes,
  };
}

function reasonFor(entry: FarmMobileNativeReportRoute): string {
  const analysis = entry.analysis;
  if (!analysis) {
    if (entry.source === "page") return `${entry.file}: mobile.native false`;
    if (entry.source === "file") return entry.file!;
    if (entry.source === "config") {
      return entry.file ? `native.routes, ${entry.file}` : "native.routes";
    }
    return "";
  }
  if (analysis.portable) {
    return analysis.wins.length > 0
      ? `portable; ${analysis.wins.join(", ")}`
      : `portable; no win (${analysis.elements.total} elements)`;
  }
  const [first, ...rest] = analysis.blockers;
  const where = first!.file ? `${first!.file}:${first!.line}:${first!.column} ` : "";
  return `${where}${first!.message}${rest.length > 0 ? ` (+${rest.length} more)` : ""}`;
}

/** The report as a table, one row per route, with the first blocker of each web route. */
export function formatFarmMobileNativeReport(
  report: FarmMobileNativeReport,
  options: { stats?: FarmMobileAnalyzerStats; file?: string } = {},
): string {
  const rows = report.routes.map((entry) => [
    entry.route,
    entry.screen,
    entry.analysis ? entry.analysis.decision : "-",
    entry.analysis ? `${entry.analysis.elements.mapped}/${entry.analysis.elements.total}` : "",
    entry.analysis ? `${entry.analysis.portablePercent}%` : "",
    reasonFor(entry),
  ]);
  const header = ["route", "screen", "decision", "mapped", "portable", "reason"];
  const widths = header.map((title, column) =>
    Math.min(
      column === 0 ? 40 : 12,
      Math.max(title.length, ...rows.map((row) => row[column]!.length)),
    ),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) =>
        column === cells.length - 1 ? cell : cell.padEnd(widths[column]!).slice(0, widths[column]),
      )
      .join("  ")
      .trimEnd();
  const { summary } = report;
  const lines = [
    `mobile.native.auto: "${report.auto}" (os: ${report.os})`,
    "",
    line(header),
    ...rows.map(line),
    "",
    `${summary.routes} routes: ${summary.port} port, ${summary.portableNoWin} portable without a ` +
      `win, ${summary.blocked} blocked, ${summary.native} native from files or config`,
  ];
  if (options.stats) {
    const { modules, parsed, cached, ms } = options.stats;
    lines.push(`analyzed ${modules} modules (${parsed} parsed, ${cached} cached) in ${ms} ms`);
  }
  if (options.file) lines.push(`full report: ${options.file}`);
  return lines.join("\n");
}
