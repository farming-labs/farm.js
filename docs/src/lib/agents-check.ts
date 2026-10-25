/**
 * The agent-ready check runs in Farm.js agent infrastructure (farmjs-infra).
 * farmjs.dev renders the form and the reports and talks to that service only
 * from its server: the API origin and key never reach the browser.
 *
 * FARMJS_API_URL  origin of the agent infrastructure API, if it isn't
 *                 https://app.farmjs.dev
 * FARMJS_API_KEY  an API key from the console's Settings > API keys; lets the
 *                 API rate-limit by the visitor's address instead of this server's
 */

import { latestFarmVersion } from "./farm-latest";

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
  /** What the site looks built with ("Next.js", "Hugo"…), when the check could tell. */
  framework?: string | null;
  /** The Farm.js version the site's manifest names; null or missing when it serves none publicly. */
  farmVersion?: string | null;
  checks: AgentCheckResult[];
}

export interface StoredAgentCheck {
  id: string;
  createdAt: string;
  report: AgentCheckReport;
  /** The newest Farm.js release when farmjs.dev served this report, to tell if the site is behind. */
  latestFarmVersion?: string;
}

const REPORT_ID = /^[a-z0-9]{12}$/;

export function isAgentCheckId(id: string): boolean {
  return REPORT_ID.test(id);
}

const DEFAULT_API_ORIGIN = "https://app.farmjs.dev";

export function agentCheckApi(): { origin: string; key: string | undefined } {
  const origin = process.env.FARMJS_API_URL?.trim().replace(/\/+$/, "") || DEFAULT_API_ORIGIN;
  return { origin, key: process.env.FARMJS_API_KEY?.trim() || undefined };
}

/** A saved report, or null when it does not exist. Throws when the service is unreachable. */
export async function fetchAgentCheck(id: string): Promise<StoredAgentCheck | null> {
  if (!isAgentCheckId(id)) return null;
  const api = agentCheckApi();
  const latest = latestFarmVersion();
  const response = await fetch(`${api.origin}/api/reports/${id}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Agent check service answered ${response.status}.`);
  const scan = (await response.json()) as StoredAgentCheck;
  return { ...scan, latestFarmVersion: await latest };
}

/**
 * A form post without JavaScript lands on /agents/check?url=<site>; this short-lived cookie
 * carries the new report's id there, so the page can show it with no id in the address.
 */
export const AGENT_CHECK_REPORT_COOKIE = "agent_check_report";
export const AGENT_CHECK_REPORT_COOKIE_MAX_AGE = 600;

export {
  AGENT_CHECK_ERRORS,
  agentCheckErrorMessage,
  agentCheckPath,
} from "./agents-check-messages";
