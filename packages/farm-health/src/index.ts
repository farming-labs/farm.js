import { definePlugin } from "@farm.js/core/plugin";
import {
  resolveHealthOptions,
  type HealthCheck,
  type HealthCheckContext,
  type HealthCheckDefinition,
  type HealthCheckOptions,
  type HealthDuration,
  type HealthOptions,
  type HealthPaths,
  type HealthProbe,
} from "./config.js";
import {
  closeHealthRuntime,
  createHealthRuntimeState,
  evaluateReadiness,
  evaluateStartup,
  type HealthCheckResult,
  type HealthReport,
  type HealthRuntimeState,
  type HealthStatus,
} from "./runtime.js";

export type {
  HealthCheck,
  HealthCheckContext,
  HealthCheckDefinition,
  HealthCheckOptions,
  HealthCheckResult,
  HealthDuration,
  HealthOptions,
  HealthPaths,
  HealthProbe,
  HealthStatus,
};

export interface HealthResponse {
  status: HealthStatus;
  checks?: Record<string, HealthCheckResult>;
}

interface HealthEndpointEvent {
  request: Request;
  state: HealthRuntimeState;
}

/** Add dependency-aware liveness, readiness, and startup endpoints to a Farm application. */
export function health(options: HealthOptions = {}) {
  const resolved = resolveHealthOptions(options);

  return definePlugin({
    name: "farm:health",
    enforce: "pre",

    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:health").length > 1
      ) {
        throw new Error("[farm:health] Configure health endpoints in one health() plugin instance");
      }

      const runtimePaths = applyBasePath(resolved.paths, normalizeBasePath(config.basePath));
      assertNoCoreHealthCollision(runtimePaths, config.server?.health);
    },

    setup() {
      return createHealthRuntimeState();
    },

    runtime: {
      endpoints: [
        createHealthEndpoint(resolved.paths.liveness, "liveness", resolved),
        createHealthEndpoint(resolved.paths.readiness, "readiness", resolved),
        createHealthEndpoint(resolved.paths.startup, "startup", resolved),
      ],
      close({ state }) {
        closeHealthRuntime(state);
      },
    },
  });
}

function createHealthEndpoint(
  path: string,
  probe: "liveness" | HealthProbe,
  options: ReturnType<typeof resolveHealthOptions>,
) {
  return {
    path,
    async handler({ request, state }: HealthEndpointEvent): Promise<Response> {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: createHealthHeaders({ allow: "GET, HEAD" }),
        });
      }

      let report: HealthReport;
      if (probe === "liveness") {
        report = {
          status: state.closed ? "unavailable" : "ok",
          checks: new Map(),
        };
      } else if (probe === "startup") {
        report = await evaluateStartup(state, options);
      } else {
        report = await evaluateReadiness(state, options);
      }

      return createHealthResponse(request, report, shouldIncludeDetails(options, request));
    },
  };
}

function shouldIncludeDetails(
  options: ReturnType<typeof resolveHealthOptions>,
  request: Request,
): boolean {
  if (typeof options.details === "boolean") return options.details;
  try {
    return options.details(request) === true;
  } catch {
    return false;
  }
}

function createHealthResponse(
  request: Request,
  report: HealthReport,
  includeDetails: boolean,
): Response {
  const unavailable = report.status === "unavailable";
  const payload: HealthResponse = {
    status: report.status,
    ...(includeDetails && report.checks.size > 0
      ? { checks: Object.fromEntries(report.checks) }
      : {}),
  };
  const body = request.method === "HEAD" ? null : JSON.stringify(payload);
  return new Response(body, {
    status: unavailable ? 503 : 200,
    headers: createHealthHeaders(unavailable ? { retryAfter: "1" } : undefined),
  });
}

function createHealthHeaders(options: { allow?: string; retryAfter?: string } = {}): Headers {
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  if (options.allow) headers.set("allow", options.allow);
  if (options.retryAfter) headers.set("retry-after", options.retryAfter);
  return headers;
}

function applyBasePath(paths: Required<HealthPaths>, basePath: string): Required<HealthPaths> {
  return {
    liveness: withBasePath(paths.liveness, basePath),
    readiness: withBasePath(paths.readiness, basePath),
    startup: withBasePath(paths.startup, basePath),
  };
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === "/") return "/";
  const normalized = `/${basePath}`.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return normalized || "/";
}

function withBasePath(path: string, basePath: string): string {
  return basePath === "/" ? path : `${basePath}${path}`;
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

function assertNoCoreHealthCollision(
  pluginPaths: Required<HealthPaths>,
  coreHealth: false | { livenessPath?: string; readinessPath?: string } | undefined,
): void {
  if (coreHealth === false) return;
  const corePaths = new Set([
    trimTrailingSlash(coreHealth?.livenessPath ?? "/_farm/health/live"),
    trimTrailingSlash(coreHealth?.readinessPath ?? "/_farm/health/ready"),
  ]);
  for (const path of Object.values(pluginPaths)) {
    if (corePaths.has(path)) {
      throw new Error(
        `[farm:health] Health endpoint ${path} conflicts with server.health; choose a different plugin path or set server.health to false`,
      );
    }
  }
}
