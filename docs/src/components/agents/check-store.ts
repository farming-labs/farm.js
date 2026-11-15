import { useSyncExternalStore } from "react";
import type { StoredAgentCheck } from "../../lib/agents-check";
import { agentCheckPath } from "../../lib/agents-check-messages";

/**
 * The check page's state, shared by the form in the hero and the report that replaces the
 * intro once a scan comes back, so a check runs and reads on one page. The address bar follows
 * it as /agents/check?url=<site>, a link that runs the check again when opened.
 */
export interface AgentCheckState {
  /** The address in the form. A rescan or "Check another site" sets it. */
  url: string;
  pending: boolean;
  /** Error code from the last run, for agentCheckErrorMessage. */
  error?: string;
  /** How many checks this page has started; the form only shows a `?error=` before the first. */
  runs: number;
  scan: StoredAgentCheck | null;
}

const initial: AgentCheckState = { url: "", pending: false, runs: 0, scan: null };
let state = initial;
const listeners = new Set<() => void>();

function update(next: Partial<AgentCheckState>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

/** Point the address bar at the shown site without navigating, while the check page is open. */
function syncAddress(url: string | undefined) {
  if (typeof window === "undefined" || window.location.pathname !== "/agents/check") return;
  const next = url ? agentCheckPath(url) : "/agents/check";
  if (window.location.pathname + window.location.search === next) return;
  window.history.replaceState(window.history.state, "", next);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentCheck(): AgentCheckState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => initial,
  );
}

/** Show a report the server already rendered, unless this page has run a check since. */
export function showAgentCheck(scan: StoredAgentCheck) {
  if (state.runs === 0 && !state.scan) update({ url: scan.report.url, scan });
}

/** Run a check and keep its report on this page. */
export async function runAgentCheck(url: string): Promise<void> {
  if (state.pending) return;
  // A rescan keeps the current report on screen until the new one arrives.
  update({ url, pending: true, error: undefined, runs: state.runs + 1 });
  try {
    const response = await fetch("/api/agents/check", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ url }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      scan?: StoredAgentCheck;
      error?: unknown;
    };
    if (response.ok && result.scan) {
      update({ pending: false, url: result.scan.report.url, scan: result.scan });
      syncAddress(result.scan.report.url);
      return;
    }
    const code =
      typeof result.error === "string"
        ? result.error
        : response.status === 429
          ? "rate_limited"
          : "failed";
    update({ pending: false, error: code });
  } catch {
    update({ pending: false, error: "unavailable" });
  }
}

/** Back to the form, optionally prefilled. */
export function resetAgentCheck(url = "") {
  update({ url, error: undefined, scan: null });
  syncAddress(undefined);
}
