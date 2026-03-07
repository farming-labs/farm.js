import type { IncomingMessage, ServerResponse } from "http";

export type IncidentSeverity = "low" | "medium" | "high" | "critical";

export type ObservabilitySignalKind =
  | "request.completed"
  | "api.response"
  | "render.completed"
  | "runtime.error"
  | "build.result"
  | "nitro.build";

export interface ObservabilitySignal {
  id: string;
  kind: ObservabilitySignalKind;
  timestamp: number;
  service: string;
  environment: string;
  tags: Record<string, string>;
  request?: {
    method: string;
    pathname: string;
    statusCode: number;
    durationMs: number;
    requestId: string;
  };
  api?: {
    method: string;
    pathname: string;
    status: number;
  };
  render?: {
    pathname: string;
    routePattern: string | null;
  };
  error?: {
    phase: string;
    message: string;
    name?: string;
  };
  build?: {
    success: boolean;
    preset: string;
    root: string;
    outputDir?: string;
  };
}

export interface ObservabilityIncident {
  id: string;
  kind: string;
  title: string;
  severity: IncidentSeverity;
  fingerprint: string;
  detectedAt: number;
  signalId: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservabilityDetectionContext {
  now: () => number;
}

export interface ObservabilityRule {
  id: string;
  severity?: IncidentSeverity;
  when: (
    signal: ObservabilitySignal,
    context: ObservabilityDetectionContext,
  ) => boolean | Promise<boolean>;
  buildIncident?: (
    signal: ObservabilitySignal,
    context: ObservabilityDetectionContext,
  ) =>
    | Partial<Omit<ObservabilityIncident, "id" | "detectedAt" | "signalId">>
    | null
    | undefined
    | Promise<Partial<Omit<ObservabilityIncident, "id" | "detectedAt" | "signalId">> | null | undefined>;
}

export interface ObservabilityFixResult {
  summary: string;
  branch?: string;
  commitSha?: string;
  metadata?: Record<string, unknown>;
}

export interface ObservabilityPipelineContext {
  signal: ObservabilitySignal;
  incident: ObservabilityIncident;
  /**
   * @deprecated Use state["fix"] or step result values in `state`.
   */
  fixResult?: ObservabilityFixResult | null;
  state: Record<string, unknown>;
}

export type ObservabilityAction = (
  context: ObservabilityPipelineContext,
) => unknown | Promise<unknown>;

export type ObservabilityPipelineStepName = string;

export interface ObservabilityWorkflowStepEvent {
  step: string;
  context: ObservabilityPipelineContext;
}

export interface ObservabilityWorkflowStepCompleteEvent extends ObservabilityWorkflowStepEvent {
  result: unknown;
}

export interface ObservabilityWorkflowStepErrorEvent extends ObservabilityWorkflowStepEvent {
  error: unknown;
}

export interface ObservabilityWorkflowErrorEvent {
  error: unknown;
  context: ObservabilityPipelineContext;
}

export interface ObservabilityWorkflowCallbacks {
  onIncident?: (context: ObservabilityPipelineContext) => void | Promise<void>;
  onPipelineStart?: (context: ObservabilityPipelineContext) => void | Promise<void>;
  onPipelineComplete?: (context: ObservabilityPipelineContext) => void | Promise<void>;
  onPipelineError?: (event: ObservabilityWorkflowErrorEvent) => void | Promise<void>;
  onStepStart?: (event: ObservabilityWorkflowStepEvent) => void | Promise<void>;
  onStepComplete?: (event: ObservabilityWorkflowStepCompleteEvent) => void | Promise<void>;
  onStepError?: (event: ObservabilityWorkflowStepErrorEvent) => void | Promise<void>;
}

export interface ObservabilityWorkflowOptions {
  pipeline?: ObservabilityPipelineStepName[];
  actions?: Record<string, ObservabilityAction>;

  /**
   * Callback lifecycle for side effects around pipeline execution.
   */
  callbacks?: ObservabilityWorkflowCallbacks;

  /**
   * Continue pipeline execution when a step fails.
   * Defaults to true to avoid affecting request handling.
   */
  continueOnStepError?: boolean;

  /**
   * @deprecated Use `callbacks.onIncident`.
   */
  onIncident?: (context: ObservabilityPipelineContext) => void | Promise<void>;

  /**
   * @deprecated Use `actions.fix` and include "fix" in `pipeline`.
   */
  runFix?: (
    context: ObservabilityPipelineContext,
  ) => ObservabilityFixResult | null | undefined | Promise<ObservabilityFixResult | null | undefined>;

  /**
   * @deprecated Use `actions.pullRequest` and include "pullRequest" in `pipeline`.
   */
  openPullRequest?: (context: ObservabilityPipelineContext) => void | Promise<void>;
}

export interface ObservabilityDetectionOptions {
  enabled?: boolean;
  dedupeWindowMs?: number;
  rules?: ObservabilityRule[];
  mapSignalToIncident?: (
    signal: ObservabilitySignal,
    context: ObservabilityDetectionContext,
  ) => ObservabilityIncident | null | undefined | Promise<ObservabilityIncident | null | undefined>;
}

export interface ObservabilityTelemetryOptions {
  slowRequestMs?: number;
  logLifecycle?: boolean;
  annotateHtml?: boolean;
}

export interface ObservabilityPluginOptions {
  service?: string;
  environment?: string;
  tags?: Record<string, string>;
  telemetry?: ObservabilityTelemetryOptions;
  detection?: ObservabilityDetectionOptions;
  workflow?: ObservabilityWorkflowOptions;

  /**
   * @deprecated Use telemetry.slowRequestMs instead.
   */
  slowRequestMs?: number;
  /**
   * @deprecated Use telemetry.logLifecycle instead.
   */
  logLifecycle?: boolean;
}

interface RequestStart {
  startedAt: number;
  method: string;
  pathname: string;
  requestId: string;
}

interface ObservabilityPlugin {
  name: string;
  enforce?: "pre" | "post";
  init?: () => void;
  ready?: () => void;
  beforeRequest?: (req: IncomingMessage, res: ServerResponse, context?: unknown) => void;
  afterResponse?: (
    req: IncomingMessage,
    res: ServerResponse,
    context?: unknown,
  ) => void | Promise<void>;
  afterApiHandler?: (
    response: Response,
    api: { method: string; pathname: string },
    context?: unknown,
  ) => Response | Promise<Response>;
  afterRender?: (
    html: string,
    render: { pathname: string; routePattern: string | null },
    context?: unknown,
  ) => string;
  onError?: (error: { phase: string; error: unknown }, context?: unknown) => void | Promise<void>;
  hmrUpdate?: (update: { file: string; modules: string[] }, context?: unknown) => void;
  afterBundle?: (
    result: { success: boolean; preset: string; root: string },
    context?: unknown,
  ) => void | Promise<void>;
  afterNitroBuild?: (
    payload: { preset: string; outputDir: string; root?: string },
    context?: unknown,
  ) => void | Promise<void>;
  shutdown?: (payload: { reason: string }, context?: unknown) => void;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function stableFingerprint(parts: Array<string | number | undefined | null>): string {
  return parts
    .map((part) => (part === undefined || part === null ? "na" : String(part).trim()))
    .join(":");
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

export function observabilityPlugin(options: ObservabilityPluginOptions = {}): ObservabilityPlugin {
  const now = () => Date.now();
  const service = options.service || process.env.FARM_SERVICE || "farm-app";
  const environment = options.environment || process.env.NODE_ENV || "development";
  const tags = options.tags || {};
  const telemetry = options.telemetry || {};
  const detection = options.detection || {};
  const workflow = options.workflow || {};
  const slowRequestMs = toPositiveInt(telemetry.slowRequestMs ?? options.slowRequestMs, 300);
  const dedupeWindowMs = toPositiveInt(detection.dedupeWindowMs, 60_000);
  const logLifecycle = telemetry.logLifecycle ?? options.logLifecycle ?? true;
  const annotateHtml = telemetry.annotateHtml ?? true;
  const detectionEnabled = detection.enabled ?? true;
  const continueOnStepError = workflow.continueOnStepError ?? true;

  const requestStarts = new WeakMap<IncomingMessage, RequestStart>();
  const recentIncidentsByFingerprint = new Map<string, number>();
  let signalCounter = 0;
  let incidentCounter = 0;

  const nextSignalId = () => `sig_${now()}_${(signalCounter++).toString(36)}`;
  const nextIncidentId = () => `inc_${now()}_${(incidentCounter++).toString(36)}`;

  const detectionContext: ObservabilityDetectionContext = { now };

  const createDefaultIncident = (
    signal: ObservabilitySignal,
  ): Omit<ObservabilityIncident, "id" | "detectedAt" | "signalId"> | null => {
    if (signal.kind === "runtime.error" && signal.error) {
      return {
        kind: "runtime-error",
        title: `Runtime error in ${signal.error.phase}`,
        severity: "critical",
        fingerprint: stableFingerprint(["runtime-error", signal.error.phase, signal.error.message]),
        summary: signal.error.message,
        metadata: { phase: signal.error.phase, name: signal.error.name },
      };
    }

    if (signal.kind === "request.completed" && signal.request) {
      if (signal.request.statusCode >= 500) {
        return {
          kind: "request-failure",
          title: `Request failure ${signal.request.method} ${signal.request.pathname}`,
          severity: "high",
          fingerprint: stableFingerprint([
            "request-failure",
            signal.request.method,
            signal.request.pathname,
            signal.request.statusCode,
          ]),
          summary: `Request returned ${signal.request.statusCode}`,
          metadata: {
            method: signal.request.method,
            pathname: signal.request.pathname,
            statusCode: signal.request.statusCode,
            durationMs: signal.request.durationMs,
          },
        };
      }

      if (signal.request.durationMs >= slowRequestMs) {
        return {
          kind: "slow-request",
          title: `Slow request ${signal.request.method} ${signal.request.pathname}`,
          severity: "medium",
          fingerprint: stableFingerprint([
            "slow-request",
            signal.request.method,
            signal.request.pathname,
          ]),
          summary: `Request took ${signal.request.durationMs}ms`,
          metadata: {
            method: signal.request.method,
            pathname: signal.request.pathname,
            statusCode: signal.request.statusCode,
            durationMs: signal.request.durationMs,
            thresholdMs: slowRequestMs,
          },
        };
      }
    }

    if (signal.kind === "api.response" && signal.api && signal.api.status >= 500) {
      return {
        kind: "api-failure",
        title: `API failure ${signal.api.method} ${signal.api.pathname}`,
        severity: "high",
        fingerprint: stableFingerprint([
          "api-failure",
          signal.api.method,
          signal.api.pathname,
          signal.api.status,
        ]),
        summary: `API returned ${signal.api.status}`,
        metadata: {
          method: signal.api.method,
          pathname: signal.api.pathname,
          status: signal.api.status,
        },
      };
    }

    return null;
  };

  const shouldDedupe = (fingerprint: string): boolean => {
    const seenAt = recentIncidentsByFingerprint.get(fingerprint);
    if (seenAt && now() - seenAt < dedupeWindowMs) {
      return true;
    }
    recentIncidentsByFingerprint.set(fingerprint, now());
    return false;
  };

  const applyRules = async (
    signal: ObservabilitySignal,
  ): Promise<Omit<ObservabilityIncident, "id" | "detectedAt" | "signalId"> | null> => {
    const rules = detection.rules || [];
    for (const rule of rules) {
      const matched = await rule.when(signal, detectionContext);
      if (!matched) continue;
      const partial = (await rule.buildIncident?.(signal, detectionContext)) || {};
      const defaultIncident = createDefaultIncident(signal);
      return {
        kind: partial.kind || defaultIncident?.kind || `rule:${rule.id}`,
        title: partial.title || defaultIncident?.title || `Incident from rule ${rule.id}`,
        severity: partial.severity || rule.severity || defaultIncident?.severity || "high",
        fingerprint:
          partial.fingerprint ||
          defaultIncident?.fingerprint ||
          stableFingerprint(["rule", rule.id, signal.kind]),
        summary: partial.summary || defaultIncident?.summary,
        metadata: {
          ...(defaultIncident?.metadata || {}),
          ...(partial.metadata || {}),
          ruleId: rule.id,
        },
      };
    }

    return null;
  };

  const resolveIncident = async (
    signal: ObservabilitySignal,
  ): Promise<ObservabilityIncident | null> => {
    const mapped = await detection.mapSignalToIncident?.(signal, detectionContext);
    if (mapped) {
      return {
        id: mapped.id || nextIncidentId(),
        kind: mapped.kind || "mapped-incident",
        title: mapped.title || "Mapped incident",
        severity: mapped.severity || "high",
        fingerprint:
          mapped.fingerprint || stableFingerprint(["mapped-incident", mapped.kind, signal.kind]),
        detectedAt: mapped.detectedAt || now(),
        signalId: mapped.signalId || signal.id,
        summary: mapped.summary,
        metadata: mapped.metadata,
      };
    }

    const byRule = await applyRules(signal);
    const chosen = byRule || createDefaultIncident(signal);
    if (!chosen) return null;

    return {
      id: nextIncidentId(),
      kind: chosen.kind,
      title: chosen.title,
      severity: chosen.severity,
      fingerprint: chosen.fingerprint,
      detectedAt: now(),
      signalId: signal.id,
      summary: chosen.summary,
      metadata: chosen.metadata,
    };
  };

  const runWorkflow = async (
    signal: ObservabilitySignal,
    incident: ObservabilityIncident,
  ): Promise<void> => {
    const context: ObservabilityPipelineContext = {
      signal,
      incident,
      state: {},
      fixResult: null,
    };
    const callbacks = workflow.callbacks || {};

    const userActions = workflow.actions || {};
    const legacyOnIncident = workflow.onIncident;

    const builtInActions: Record<string, ObservabilityAction> = {
      notify: async (ctx) => {
        const onIncident = callbacks.onIncident || legacyOnIncident;
        if (onIncident) {
          await onIncident(ctx);
          return;
        }
        console.warn(
          `[obs] incident detected kind=${ctx.incident.kind} severity=${ctx.incident.severity} id=${ctx.incident.id} title="${ctx.incident.title}"`,
        );
      },
      log: async (ctx) => {
        console.log(
          `[obs] pipeline incident=${ctx.incident.id} kind=${ctx.incident.kind} severity=${ctx.incident.severity}`,
        );
      },
    };

    // Backward-compatibility shims. Prefer defining these steps via workflow.actions.
    const legacyActions: Record<string, ObservabilityAction> = {};
    if (workflow.runFix) {
      legacyActions.fix = async (ctx) => {
        const result = (await workflow.runFix?.(ctx)) || null;
        ctx.fixResult = result;
        return result;
      };
    }
    if (workflow.openPullRequest) {
      legacyActions.pullRequest = async (ctx) => {
        if (!ctx.fixResult) return null;
        await workflow.openPullRequest?.(ctx);
        return ctx.fixResult;
      };
    }

    const actionRegistry: Record<string, ObservabilityAction> = {
      ...builtInActions,
      ...legacyActions,
      ...userActions,
    };

    const hasFixPath = typeof workflow.runFix === "function";
    const hasPrPath = typeof workflow.openPullRequest === "function";
    const pipeline =
      workflow.pipeline && workflow.pipeline.length > 0
        ? workflow.pipeline
        : hasFixPath
          ? hasPrPath
            ? (["notify", "fix", "pullRequest"] as const)
            : (["notify", "fix"] as const)
          : (["notify"] as const);

    try {
      await callbacks.onPipelineStart?.(context);

      for (const step of pipeline) {
        const action = actionRegistry[step];
        if (!action) {
          const message = `[obs] pipeline step "${step}" is not registered`;
          if (!continueOnStepError) throw new Error(message);
          console.warn(message);
          continue;
        }

        try {
          await callbacks.onStepStart?.({ step, context });
          const result = await action(context);
          if (result !== undefined) {
            context.state[step] = result;
            if (step === "fix") {
              context.fixResult = result as ObservabilityFixResult;
            }
          }
          await callbacks.onStepComplete?.({ step, context, result });
        } catch (error) {
          await callbacks.onStepError?.({ step, context, error });
          const message = `[obs] pipeline step "${step}" failed: ${errorMessage(error)}`;
          if (!continueOnStepError) throw new Error(message);
          console.error(message);
        }
      }

      await callbacks.onPipelineComplete?.(context);
    } catch (error) {
      await callbacks.onPipelineError?.({ error, context });
      throw error;
    }
  };

  const processSignal = async (signal: ObservabilitySignal): Promise<void> => {
    if (!detectionEnabled) return;

    const incident = await resolveIncident(signal);
    if (!incident) return;
    if (shouldDedupe(incident.fingerprint)) return;

    try {
      await runWorkflow(signal, incident);
    } catch (error) {
      console.error(`[obs] workflow failed incident=${incident.id} error=${errorMessage(error)}`);
    }
  };

  const createSignal = (
    kind: ObservabilitySignalKind,
    payload: Omit<ObservabilitySignal, "id" | "kind" | "timestamp" | "service" | "environment" | "tags">,
  ): ObservabilitySignal => {
    return {
      id: nextSignalId(),
      kind,
      timestamp: now(),
      service,
      environment,
      tags,
      ...payload,
    };
  };

  return {
    name: "@farmjs/plugin-observability",
    enforce: "post",

    init() {
      if (logLifecycle) console.log("[obs] init");
    },

    ready() {
      if (logLifecycle) console.log("[obs] ready");
    },

    beforeRequest(req) {
      const pathname = req.url || "/";
      const method = req.method || "GET";
      const requestId = `req_${now()}_${(signalCounter++).toString(36)}`;
      requestStarts.set(req, {
        startedAt: now(),
        method,
        pathname,
        requestId,
      });
    },

    async afterResponse(req, res) {
      const started = requestStarts.get(req);
      if (!started) return;
      requestStarts.delete(req);

      const signal = createSignal("request.completed", {
        request: {
          method: started.method,
          pathname: started.pathname,
          statusCode: res.statusCode || 200,
          durationMs: now() - started.startedAt,
          requestId: started.requestId,
        },
      });
      await processSignal(signal);
    },

    async afterApiHandler(response, api) {
      const signal = createSignal("api.response", {
        api: {
          method: api.method,
          pathname: api.pathname,
          status: response.status,
        },
      });
      await processSignal(signal);
      return response;
    },

    afterRender(html, render) {
      if (!annotateHtml) return html;
      const marker = `<!-- observability:path=${render.pathname} route=${render.routePattern ?? "unmatched"} -->`;
      return html.includes("</body>")
        ? html.replace("</body>", `${marker}\n</body>`)
        : `${html}\n${marker}`;
    },

    async onError(error) {
      const message = errorMessage(error.error);
      const signal = createSignal("runtime.error", {
        error: {
          phase: error.phase,
          message,
          name: error.error instanceof Error ? error.error.name : undefined,
        },
      });
      await processSignal(signal);
    },

    hmrUpdate(update) {
      if (!logLifecycle) return;
      console.log(`[obs] hmr file=${update.file} modules=${update.modules.length}`);
    },

    async afterBundle(result) {
      if (logLifecycle) {
        const state = result.success ? "success" : "failed";
        console.log(`[obs] bundle ${state} preset=${result.preset} root=${result.root}`);
      }

      const signal = createSignal("build.result", {
        build: {
          success: result.success,
          preset: result.preset,
          root: result.root,
        },
      });
      await processSignal(signal);
    },

    async afterNitroBuild(payload) {
      if (logLifecycle) {
        console.log(`[obs] nitro preset=${payload.preset} output=${payload.outputDir}`);
      }
      const signal = createSignal("nitro.build", {
        build: {
          success: true,
          preset: payload.preset,
          root: payload.root || process.cwd(),
          outputDir: payload.outputDir,
        },
      });
      await processSignal(signal);
    },

    shutdown(payload) {
      if (logLifecycle) console.log(`[obs] shutdown reason=${payload.reason}`);
      recentIncidentsByFingerprint.clear();
    },
  };
}
