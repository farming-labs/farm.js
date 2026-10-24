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
  /** Readiness run shared by every request that arrives while it is pending. */
  readinessPromise?: Promise<HealthReport>;
  /** Last readiness result, reused until `expiresAt`. */
  readinessCache?: { report: HealthReport; expiresAt: number };
  /** Check invocations that have not settled yet, including ones a timeout already gave up on. */
  runningChecks: Map<ResolvedHealthCheck, Promise<boolean>>;
}

export function createHealthRuntimeState(): HealthRuntimeState {
  return {
    controller: new AbortController(),
    closed: false,
    runningChecks: new Map(),
  };
}

export function closeHealthRuntime(state: HealthRuntimeState): void {
  if (state.closed) return;
  state.closed = true;
  state.readinessCache = undefined;
  state.controller.abort(new Error("Farm health runtime closed"));
}

export async function evaluateStartup(
  state: HealthRuntimeState,
  options: ResolvedHealthOptions,
): Promise<HealthReport> {
  if (state.closed) return unavailableReport();
  if (state.startupReport) return state.startupReport;
  if (state.startupPromise) return state.startupPromise;

  const pending = runChecks(state, options.startupChecks, "startup");
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
  const cached = state.readinessCache;
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  if (state.readinessPromise) return state.readinessPromise;

  const pending = runReadiness(state, options);
  state.readinessPromise = pending;
  try {
    const report = await pending;
    if (options.cacheMs > 0 && !state.closed) {
      state.readinessCache = { report, expiresAt: Date.now() + options.cacheMs };
    }
    return report;
  } finally {
    if (state.readinessPromise === pending) state.readinessPromise = undefined;
  }
}

async function runReadiness(
  state: HealthRuntimeState,
  options: ResolvedHealthOptions,
): Promise<HealthReport> {
  const startup = await evaluateStartup(state, options);
  if (startup.status === "unavailable") return startup;

  const readiness = await runChecks(state, options.checks, "readiness");
  return mergeReports(startup, readiness);
}

async function runChecks(
  state: HealthRuntimeState,
  checks: ResolvedHealthCheck[],
  probe: HealthProbe,
): Promise<HealthReport> {
  const results = await Promise.all(
    checks.map(async (check) => [check.name, await runCheck(state, check, probe)] as const),
  );
  return createReport(new Map(results));
}

async function runCheck(
  state: HealthRuntimeState,
  definition: ResolvedHealthCheck,
  probe: HealthProbe,
): Promise<HealthCheckResult> {
  const runtimeSignal = state.controller.signal;
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

  // A check that ignores its signal keeps running after a timeout. Join that invocation instead of
  // starting another one, so slow dependencies never accumulate concurrent checks.
  let completion = state.runningChecks.get(definition);
  if (!completion) {
    const started = Promise.resolve()
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
      )
      .finally(() => {
        if (state.runningChecks.get(definition) === started) {
          state.runningChecks.delete(definition);
        }
      });
    state.runningChecks.set(definition, started);
    completion = started;
  }

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
