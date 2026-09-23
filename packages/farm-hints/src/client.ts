"use client";

import { onCLS, onINP, onLCP } from "web-vitals";
import { createHintsOverlay, type HintsOverlay } from "./overlay.js";
import { collectDocumentHints } from "./scan.js";
import type { ResolvedHintsOptions } from "./config.js";
import type { FarmHintsRuntime, HintIssue, HintMetric, HintsSnapshot } from "./types.js";

export type { FarmHintsRuntime, HintCategory, HintIssue, HintMetric } from "./types.js";

/** Start the development-only hints scanner and route-aware overlay. */
export function startHintsRuntime(
  options: ResolvedHintsOptions,
  runtimeWindow: Window = window,
): FarmHintsRuntime {
  const document = runtimeWindow.document;
  const staticIssues = new Map<string, HintIssue>();
  const runtimeIssues = new Map<string, HintIssue>();
  const metrics = new Map<HintMetric["id"], HintMetric>();
  let pathname = runtimeWindow.location.pathname;
  let scanning = true;
  let closed = false;
  let scanSequence = 0;
  let scanTimer: ReturnType<typeof setTimeout> | undefined;
  let resourceObserver: PerformanceObserver | undefined;
  let overlay: HintsOverlay | undefined;
  let lastConsoleFingerprint = "";

  const snapshot = (): HintsSnapshot => ({
    pathname,
    scanning,
    issues: [...runtimeIssues.values(), ...staticIssues.values()].slice(0, options.maxIssues),
    metrics: [...metrics.values()],
  });

  const publish = () => {
    const value = snapshot();
    overlay?.update(value);
    if (options.report === "console" || options.report === "both") reportToConsole(value);
  };

  const reportToConsole = (value: HintsSnapshot) => {
    if (value.scanning) return;
    const fingerprint = value.issues.map((issue) => issue.id).join("|");
    if (fingerprint === lastConsoleFingerprint) return;
    lastConsoleFingerprint = fingerprint;
    const summary = `${value.issues.length} hint${value.issues.length === 1 ? "" : "s"} on ${value.pathname}`;
    if (value.issues.length === 0) {
      console.info(`[Farm Hints] ${summary}`);
      return;
    }
    console.groupCollapsed(`[Farm Hints] ${summary}`);
    for (const issue of value.issues) {
      const method = issue.severity === "info" ? "info" : "warn";
      console[method](`[${issue.category}] ${issue.title}`, issue.selector ?? "", issue.detail);
    }
    console.groupEnd();
  };

  async function scan(_reason = "manual", nextPathname = runtimeWindow.location.pathname) {
    if (closed) return;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = undefined;
    }
    const sequence = ++scanSequence;
    pathname = nextPathname;
    scanning = true;
    publish();
    try {
      const issues = await collectDocumentHints(document, runtimeWindow, options);
      if (closed || sequence !== scanSequence) return;
      staticIssues.clear();
      for (const issue of issues) staticIssues.set(issue.id, issue);
    } catch (error) {
      if (closed || sequence !== scanSequence) return;
      console.warn("[Farm Hints] The page scan could not finish.", error);
    } finally {
      if (!closed && sequence === scanSequence) {
        scanning = false;
        publish();
      }
    }
  }

  function scheduleScan(reason: string): void {
    if (closed) return;
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => void scan(reason), 120);
  }

  function recordTiming(
    kind: "hydration" | "navigation",
    durationMs: number,
    nextPathname = runtimeWindow.location.pathname,
  ): void {
    if (closed || !options.performance) return;
    pathname = nextPathname;
    const id = kind === "hydration" ? "HYDRATION" : "NAVIGATION";
    const threshold = options.performance[kind];
    upsertMetric(id, durationMs, "ms", threshold);
    const issueId = `performance:${kind}`;
    if (durationMs > threshold) {
      runtimeIssues.set(issueId, {
        id: issueId,
        category: "performance",
        severity: durationMs > threshold * 1.5 ? "serious" : "warning",
        title: `${kind === "hydration" ? "Hydration" : "Client navigation"} took ${Math.round(durationMs)} ms`,
        detail: `The configured warning threshold is ${threshold} ms. Profile this route before increasing the threshold.`,
      });
    } else {
      runtimeIssues.delete(issueId);
    }
    publish();
  }

  function recordVital(id: "LCP" | "CLS" | "INP", value: number): void {
    if (closed || !options.performance || !Number.isFinite(value)) return;
    const threshold = options.performance[id.toLowerCase() as "lcp" | "cls" | "inp"];
    const unit = id === "CLS" ? "score" : "ms";
    upsertMetric(id, value, unit, threshold);
    const issueId = `performance:vital:${id}`;
    if (value > threshold) {
      const shown = unit === "score" ? value.toFixed(3) : `${Math.round(value)} ms`;
      const expected = unit === "score" ? String(threshold) : `${threshold} ms`;
      runtimeIssues.set(issueId, {
        id: issueId,
        category: "performance",
        severity: value > threshold * 1.5 ? "serious" : "warning",
        title: `${id} is ${shown}`,
        detail: `${id} exceeded the configured ${expected} threshold on this page view.`,
      });
    } else {
      runtimeIssues.delete(issueId);
    }
    publish();
  }

  function upsertMetric(
    id: HintMetric["id"],
    value: number,
    unit: HintMetric["unit"],
    threshold: number,
  ): void {
    metrics.set(id, {
      id,
      value,
      unit,
      status: value <= threshold ? "good" : value <= threshold * 1.5 ? "needs-improvement" : "poor",
    });
  }

  if (options.report === "overlay" || options.report === "both") {
    overlay = createHintsOverlay({
      window: runtimeWindow,
      position: options.overlay.position,
      open: options.overlay.open,
      onRescan: () => void scan("manual"),
    });
  }

  const mutationObserver = new MutationObserver((records) => {
    const appChanged = records.some((record) => {
      const target = record.target as Element;
      return target.nodeType !== 1 || !target.closest?.("farm-hints");
    });
    if (appChanged) scheduleScan("dom");
  });
  mutationObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "alt",
      "aria-label",
      "aria-labelledby",
      "async",
      "defer",
      "height",
      "href",
      "id",
      "lang",
      "role",
      "src",
      "type",
      "width",
    ],
  });

  if (options.performance) {
    onLCP((metric) => recordVital("LCP", metric.value), { reportAllChanges: true });
    onCLS((metric) => recordVital("CLS", metric.value), { reportAllChanges: true });
    onINP((metric) => recordVital("INP", metric.value), { reportAllChanges: true });
  }

  if (options.thirdParty && typeof PerformanceObserver !== "undefined") {
    resourceObserver = new PerformanceObserver(() => scheduleScan("resource"));
    try {
      resourceObserver.observe({ type: "resource", buffered: true });
    } catch {
      resourceObserver = undefined;
    }
  }

  scheduleScan("setup");

  return {
    scan,
    recordTiming,
    close() {
      if (closed) return;
      closed = true;
      scanSequence += 1;
      if (scanTimer) clearTimeout(scanTimer);
      mutationObserver.disconnect();
      resourceObserver?.disconnect();
      overlay?.destroy();
    },
  };
}
