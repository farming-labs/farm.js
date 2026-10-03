/**
 * The agent-ready check runs in Farm.js agent infrastructure (farmjs-infra).
 * farmjs.dev renders the form and the reports and talks to that service only
 * from its server: the API origin and key never reach the browser.
 *
 * FARMJS_API_URL  origin of the agent infrastructure API
 * FARMJS_API_KEY  an API key from the console's Settings > API keys; lets the
 *                 API rate-limit by the visitor's address instead of this server's
 */

export type AgentCheckStatus = "pass" | "warn" | "fail" | "info";

export interface AgentCheckResult {
  id: string;
  title: string;
  status: AgentCheckStatus;
  summary: string;
  evidence: string[];
  weight: number;
  fix?: { summary: string; farm?: { file: string; code: string }; docs?: string };
}

export interface AgentCheckReport {
  url: string;
  finalUrl: string;
  scannedAt: string;
  durationMs: number;
  score: number;
  farm: boolean;
  checks: AgentCheckResult[];
}

export interface StoredAgentCheck {
  id: string;
  createdAt: string;
  report: AgentCheckReport;
}

const REPORT_ID = /^[a-z0-9]{12}$/;

export function isAgentCheckId(id: string): boolean {
  return REPORT_ID.test(id);
}

export function agentCheckApi(): { origin: string; key: string | undefined } | null {
  const origin = process.env.FARMJS_API_URL?.trim().replace(/\/+$/, "");
  if (!origin) return null;
  return { origin, key: process.env.FARMJS_API_KEY?.trim() || undefined };
}

/** A saved report, or null when it does not exist. Throws when the service is unreachable. */
export async function fetchAgentCheck(id: string): Promise<StoredAgentCheck | null> {
  if (!isAgentCheckId(id)) return null;
  const api = agentCheckApi();
  if (!api) throw new Error("The agent-ready check is not configured.");
  const response = await fetch(`${api.origin}/api/reports/${id}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Agent check service answered ${response.status}.`);
  return (await response.json()) as StoredAgentCheck;
}

export { AGENT_CHECK_ERRORS, agentCheckErrorMessage } from "./agents-check-messages";
