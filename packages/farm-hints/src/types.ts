import type { ResolvedHintsOptions } from "./config.js";

export type HintCategory = "accessibility" | "performance" | "html" | "third-party";
export type HintSeverity = "info" | "warning" | "serious" | "critical";

export interface HintIssue {
  id: string;
  category: HintCategory;
  severity: HintSeverity;
  title: string;
  detail: string;
  selector?: string;
  snippet?: string;
  helpUrl?: string;
}

export interface HintMetric {
  id: "LCP" | "CLS" | "INP" | "HYDRATION" | "NAVIGATION";
  value: number;
  unit: "ms" | "score";
  status: "good" | "needs-improvement" | "poor";
}

export interface HintsSnapshot {
  pathname: string;
  scanning: boolean;
  issues: HintIssue[];
  metrics: HintMetric[];
}

export interface FarmHintsRuntime {
  scan(reason?: string, pathname?: string): Promise<void>;
  recordTiming(kind: "hydration" | "navigation", durationMs: number, pathname?: string): void;
  close(): void;
}

export type HintsRuntimeOptions = ResolvedHintsOptions;
