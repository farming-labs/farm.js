import type { HealthProbe, ResolvedHealthCheck, ResolvedHealthOptions } from "./config.js";

export type HealthStatus = "ok" | "degraded" | "unavailable";

export interface HealthCheckResult {
  status: "ok" | "unavailable";
  required: boolean;
  probe: HealthProbe;
  durationMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  checks: Map<string, HealthCheckResult>;
}

export interface HealthRuntimeState {
  controller: AbortController;
  closed: boolean;
  startupReport?: HealthReport;
  startupPromise?: Promise<HealthReport>;
}

export function createHealthRuntimeState(): HealthRuntimeState {
  return {
    controller: new AbortController(),
    closed: false,
  };
}

export function closeHealthRuntime(state: HealthRuntimeState): void {
  if (state.closed) return;
  state.closed = true;
  state.controller.abort(new Error("Farm health runtime closed"));
}

export async function evaluateStartup(
  state: HealthRuntimeState,
  options: ResolvedHealthOptions,
): Promise<HealthReport> {
  if (state.closed) return unavailableReport();
  if (state.startupReport) return state.startupReport;
  if (state.startupPromise) return state.startupPromise;

  const pending = runChecks(options.startupChecks, "startup", state.controller.signal);
  state.startupPromise = pending;
  try {
    const report = await pending;
    if (report.status !== "unavailable") {
      state.startupReport = report;
    }
    return report;
  } finally {
    if (state.startupPromise === pending) state.startupPromise = undefined;
  }
}

export async function evaluateReadiness(
  state: HealthRuntimeState,
  options: ResolvedHealthOptions,
): Promise<HealthReport> {
  if (state.closed) return unavailableReport();
  const startup = await evaluateStartup(state, options);
  if (startup.status === "unavailable") return startup;

  const readiness = await runChecks(options.checks, "readiness", state.controller.signal);
  return mergeReports(startup, readiness);
}

async function runChecks(
  checks: ResolvedHealthCheck[],
  probe: HealthProbe,
  runtimeSignal: AbortSignal,
): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (check) => [check.name, await runCheck(check, probe, runtimeSignal)] as const),
  );
  return createReport(new Map(results));
}

async function runCheck(
  definition: ResolvedHealthCheck,
  probe: HealthProbe,
  runtimeSignal: AbortSignal,
): Promise<HealthCheckResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const abortForRuntime = () => controller.abort(runtimeSignal.reason);
  if (runtimeSignal.aborted) abortForRuntime();
  else runtimeSignal.addEventListener("abort", abortForRuntime, { once: true });

  let resolveInterruption!: (passed: false) => void;
  const interruption = new Promise<false>((resolve) => {
    resolveInterruption = resolve;
  });
  const abortCheck = () => resolveInterruption(false);
  if (controller.signal.aborted) abortCheck();
  else controller.signal.addEventListener("abort", abortCheck, { once: true });

  const timeout = setTimeout(() => {
    controller.abort(new Error(`Health check ${definition.name} timed out`));
  }, definition.timeoutMs);
  timeout.unref?.();

  const completion = Promise.resolve()
    .then(() =>
      definition.check({
        name: definition.name,
        probe,
        signal: controller.signal,
      }),
    )
    .then(
      (result) => result !== false,
      () => false,
    );

  const passed = await Promise.race([completion, interruption]);
  clearTimeout(timeout);
  controller.signal.removeEventListener("abort", abortCheck);
  runtimeSignal.removeEventListener("abort", abortForRuntime);

  return {
    status: passed ? "ok" : "unavailable",
    required: definition.required,
    probe,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

function unavailableReport(): HealthReport {
  return { status: "unavailable", checks: new Map() };
}

function createReport(checks: Map<string, HealthCheckResult>): HealthReport {
  let optionalFailure = false;
  for (const check of checks.values()) {
    if (check.status === "ok") continue;
    if (check.required) return { status: "unavailable", checks };
    optionalFailure = true;
  }
  return { status: optionalFailure ? "degraded" : "ok", checks };
}

function mergeReports(left: HealthReport, right: HealthReport): HealthReport {
  const checks = new Map([...left.checks, ...right.checks]);
  if (left.status === "unavailable" || right.status === "unavailable") {
    return { status: "unavailable", checks };
  }
  if (left.status === "degraded" || right.status === "degraded") {
    return { status: "degraded", checks };
  }
  return { status: "ok", checks };
}
