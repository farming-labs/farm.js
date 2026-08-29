export type AnalyzerMetric = "raw" | "gzip" | "brotli";
export type AnalyzerLimitAction = "error" | "warn";
export type AnalyzerSize = number | `${number}${"b" | "kb" | "mb" | "gb"}`;

export interface AnalyzerLimits {
  /** Maximum initial JavaScript and CSS for each emitted HTML page. */
  page?: AnalyzerSize;
  /** Maximum size of any single emitted JavaScript or CSS file. */
  asset?: AnalyzerSize;
  /** Maximum total size of emitted client JavaScript and CSS. */
  client?: AnalyzerSize;
  /** Maximum total size of emitted server JavaScript. */
  server?: AnalyzerSize;
}

export interface AnalyzerOptions {
  /** Set false to keep the plugin configured without analyzing builds. */
  enabled?: boolean;
  /** HTML report path relative to the project root. Set false to skip it. */
  output?: string | false;
  /** Also write JSON. True uses the HTML report name with a .json extension. */
  json?: boolean | string;
  /** Open the HTML report after a successful build. */
  open?: boolean;
  /** Size used when evaluating limits. The report always includes every metric. */
  metric?: AnalyzerMetric;
  /** Optional build limits. Numbers are bytes; strings accept b, kb, mb, or gb. */
  limits?: AnalyzerLimits;
  /** Whether an exceeded limit fails the build or prints a warning. */
  onLimit?: AnalyzerLimitAction;
}

export interface ResolvedAnalyzerLimits {
  page?: number;
  asset?: number;
  client?: number;
  server?: number;
}

export interface ResolvedAnalyzerOptions {
  enabled: boolean;
  output: string | false;
  json: string | false;
  open: boolean;
  metric: AnalyzerMetric;
  limits: ResolvedAnalyzerLimits;
  onLimit: AnalyzerLimitAction;
}

const DEFAULT_OUTPUT = ".farm/analyze.html";

export function resolveAnalyzerOptions(options: AnalyzerOptions = {}): ResolvedAnalyzerOptions {
  const output = normalizeOutput(options.output ?? DEFAULT_OUTPUT, "output");
  if (options.open && output === false) {
    throw new TypeError("Analyzer open needs an HTML output path");
  }

  const metric = options.metric ?? "gzip";
  if (metric !== "raw" && metric !== "gzip" && metric !== "brotli") {
    throw new TypeError('Analyzer metric must be "raw", "gzip", or "brotli"');
  }

  const onLimit = options.onLimit ?? "error";
  if (onLimit !== "error" && onLimit !== "warn") {
    throw new TypeError('Analyzer onLimit must be "error" or "warn"');
  }

  return {
    enabled: options.enabled !== false,
    output,
    json: resolveJsonOutput(options.json ?? false, output),
    open: options.open ?? false,
    metric,
    limits: resolveLimits(options.limits ?? {}),
    onLimit,
  };
}

export function parseAnalyzerSize(value: AnalyzerSize): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0) {
      throw new TypeError("Analyzer limits must be positive finite byte values");
    }
    return Math.round(value);
  }

  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value);
  if (!match) {
    throw new TypeError('Analyzer limits must use a size such as "100kb", "1.5mb", or "2gb"');
  }

  const multiplier = {
    b: 1,
    kb: 1_024,
    mb: 1_048_576,
    gb: 1_073_741_824,
  }[match[2].toLowerCase() as "b" | "kb" | "mb" | "gb"];

  const bytes = Number(match[1]) * multiplier;
  if (bytes <= 0) throw new TypeError("Analyzer limits must be positive sizes");
  return Math.round(bytes);
}

function resolveLimits(limits: AnalyzerLimits): ResolvedAnalyzerLimits {
  return {
    page: limits.page === undefined ? undefined : parseAnalyzerSize(limits.page),
    asset: limits.asset === undefined ? undefined : parseAnalyzerSize(limits.asset),
    client: limits.client === undefined ? undefined : parseAnalyzerSize(limits.client),
    server: limits.server === undefined ? undefined : parseAnalyzerSize(limits.server),
  };
}

function resolveJsonOutput(value: boolean | string, output: string | false): string | false {
  if (value === false) return false;
  if (typeof value === "string") return normalizeOutput(value, "json") as string;
  if (output === false) return ".farm/analyze.json";
  return output.replace(/(?:\.[^./\\]+)?$/, ".json");
}

function normalizeOutput(value: string | false, label: string): string | false {
  if (value === false) return false;
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`Analyzer ${label} must be a non-empty path`);
  return normalized;
}
