export type HealthDuration = number | `${number}${"ms" | "s" | "m" | "h"}`;

export type HealthProbe = "readiness" | "startup";

export interface HealthCheckContext {
  /** Stable name assigned to this check in the plugin configuration. */
  name: string;
  /** Probe currently evaluating the check. */
  probe: HealthProbe;
  /** Aborted when the check times out or the Farm runtime closes. */
  signal: AbortSignal;
}

export type HealthCheck = (context: HealthCheckContext) => unknown | Promise<unknown>;

export interface HealthCheckOptions {
  /** Function that verifies the dependency. Returning false, throwing, or timing out fails the check. */
  check: HealthCheck;
  /** Whether a failure removes the instance from service. Defaults to true. */
  required?: boolean;
  /** Per-check timeout. Overrides the plugin-level timeout. */
  timeout?: HealthDuration;
}

export type HealthCheckDefinition = HealthCheck | HealthCheckOptions;

export interface HealthPaths {
  /** Process liveness path. */
  liveness?: string;
  /** Dependency-aware traffic readiness path. */
  readiness?: string;
  /** One-time application startup path. */
  startup?: string;
}

export interface HealthOptions {
  /** Checks evaluated on every readiness request. */
  checks?: Record<string, HealthCheckDefinition>;
  /** Checks evaluated until required startup work succeeds, then latched for this runtime. */
  startupChecks?: Record<string, HealthCheckDefinition>;
  /** Public probe paths. Farm's basePath is applied automatically. */
  paths?: HealthPaths;
  /** Default timeout for each check. Defaults to one second. */
  timeout?: HealthDuration;
  /** Include safe check names, states, and timings in responses. Defaults to false. */
  details?: boolean | ((request: Request) => boolean);
}

export interface ResolvedHealthCheck {
  name: string;
  check: HealthCheck;
  required: boolean;
  timeoutMs: number;
}

export interface ResolvedHealthOptions {
  checks: ResolvedHealthCheck[];
  startupChecks: ResolvedHealthCheck[];
  paths: Required<HealthPaths>;
  timeoutMs: number;
  details: NonNullable<HealthOptions["details"]>;
}

const DEFAULT_TIMEOUT = 1_000;
const MAX_TIMEOUT = 2_147_483_647;
const UNSAFE_CHECK_NAMES = new Set(["__proto__", "prototype", "constructor"]);

export function resolveHealthOptions(options: HealthOptions = {}): ResolvedHealthOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("Health options must be an object");
  }
  if ("enabled" in options) {
    throw new TypeError(
      "Health does not accept enabled; remove health() from plugins to disable it",
    );
  }

  const timeoutMs = parseHealthDuration(
    options.timeout === undefined ? DEFAULT_TIMEOUT : options.timeout,
    "health timeout",
  );
  const paths = resolvePaths(options.paths);
  const checks = resolveChecks(options.checks, timeoutMs, "checks");
  const startupChecks = resolveChecks(options.startupChecks, timeoutMs, "startupChecks");
  const names = new Set(checks.map((check) => check.name));
  for (const check of startupChecks) {
    if (names.has(check.name)) {
      throw new TypeError(
        `Health check name ${JSON.stringify(check.name)} is used in both checks and startupChecks`,
      );
    }
  }

  if (
    options.details !== undefined &&
    typeof options.details !== "boolean" &&
    typeof options.details !== "function"
  ) {
    throw new TypeError("Health details must be a boolean or request predicate");
  }

  return {
    checks,
    startupChecks,
    paths,
    timeoutMs,
    details: options.details ?? false,
  };
}

function resolvePaths(paths: HealthPaths | undefined): Required<HealthPaths> {
  if (paths !== undefined && (!paths || typeof paths !== "object" || Array.isArray(paths))) {
    throw new TypeError("Health paths must be an object");
  }

  const resolved = {
    liveness: normalizeHealthPath(paths?.liveness ?? "/health/live", "health paths.liveness"),
    readiness: normalizeHealthPath(paths?.readiness ?? "/health/ready", "health paths.readiness"),
    startup: normalizeHealthPath(paths?.startup ?? "/health/startup", "health paths.startup"),
  };
  if (new Set(Object.values(resolved)).size !== 3) {
    throw new TypeError("Health liveness, readiness, and startup paths must be different");
  }
  return resolved;
}

function resolveChecks(
  value: Record<string, HealthCheckDefinition> | undefined,
  defaultTimeoutMs: number,
  optionName: string,
): ResolvedHealthCheck[] {
  if (value === undefined) return [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`Health ${optionName} must be an object of named checks`);
  }

  return Object.entries(value).map(([name, definition]) => {
    const normalizedName = name.trim();
    if (!normalizedName || UNSAFE_CHECK_NAMES.has(normalizedName)) {
      throw new TypeError(`Health ${optionName} contains an invalid check name`);
    }
    if (normalizedName !== name) {
      throw new TypeError(
        `Health ${optionName} check names must not contain surrounding whitespace`,
      );
    }

    if (typeof definition === "function") {
      return {
        name,
        check: definition,
        required: true,
        timeoutMs: defaultTimeoutMs,
      };
    }
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) {
      throw new TypeError(
        `Health check ${JSON.stringify(name)} must be a function or options object`,
      );
    }
    if (typeof definition.check !== "function") {
      throw new TypeError(`Health check ${JSON.stringify(name)} requires a check function`);
    }
    if (definition.required !== undefined && typeof definition.required !== "boolean") {
      throw new TypeError(`Health check ${JSON.stringify(name)} required must be a boolean`);
    }

    return {
      name,
      check: definition.check,
      required: definition.required ?? true,
      timeoutMs:
        definition.timeout === undefined
          ? defaultTimeoutMs
          : parseHealthDuration(definition.timeout, `health check ${JSON.stringify(name)} timeout`),
    };
  });
}

export function parseHealthDuration(value: HealthDuration, optionName = "health duration"): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_TIMEOUT) {
      throw new TypeError(`${optionName} must be a positive safe integer in milliseconds`);
    }
    return value;
  }
  if (typeof value !== "string") {
    throw new TypeError(`${optionName} must be milliseconds or a duration such as "500ms" or "2s"`);
  }

  const match = value
    .trim()
    .toLowerCase()
    .match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/);
  if (!match) {
    throw new TypeError(`${optionName} must be milliseconds or a duration such as "500ms" or "2s"`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "ms" ? 1 : unit === "s" ? 1_000 : unit === "m" ? 60_000 : 3_600_000;
  const milliseconds = Math.floor(amount * multiplier);
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0 || milliseconds > MAX_TIMEOUT) {
    throw new TypeError(`${optionName} must resolve to a positive safe integer in milliseconds`);
  }
  return milliseconds;
}

export function normalizeHealthPath(value: string, optionName: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${optionName} must be an absolute pathname`);
  }
  const path = value.trim();
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path === "/" ||
    path.includes("?") ||
    path.includes("#") ||
    path.includes("*") ||
    path.includes("\\") ||
    path.includes("//") ||
    hasControlCharacter(path)
  ) {
    throw new TypeError(
      `${optionName} must be a safe absolute pathname without a query or wildcard`,
    );
  }

  const normalized = path.replace(/\/+$/, "");
  for (const segment of normalized.split("/").slice(1)) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      throw new TypeError(`${optionName} contains invalid URL encoding`);
    }
    if (decoded === "." || decoded === ".." || decoded.includes("/") || decoded.includes("\\")) {
      throw new TypeError(`${optionName} contains an unsafe path segment`);
    }
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
