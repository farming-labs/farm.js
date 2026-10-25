import type { RequestMiddlewareContext } from "@farm.js/core/middleware";
import {
  AGENT_CHECK_REPORT_COOKIE,
  agentCheckPath,
  fetchAgentCheck,
  isAgentCheckId,
  type StoredAgentCheck,
} from "../../../lib/agents-check";

export interface AgentCheckMiddlewareData {
  /** The report a form post without JavaScript just ran, for /agents/check?url=<its site>. */
  agentCheckScan: StoredAgentCheck;
}

const OLD_REPORT_PATH = /^\/agents\/check\/([^/]+)\/?$/;

/**
 * Reports live at /agents/check?url=<site>, never at an id. Links to the old
 * /agents/check/<id> pages go to the check for that report's site. A form post
 * without JavaScript leaves its report's id in a cookie (see the API route), and
 * the page it lands on shows that report when it is for the site in `?url=`.
 */
export async function middleware(
  request: Request,
  context: RequestMiddlewareContext<Record<string, never>, AgentCheckMiddlewareData>,
) {
  if (context.method !== "GET" && context.method !== "HEAD") return;

  const old = OLD_REPORT_PATH.exec(context.pathname)?.[1];
  if (old !== undefined) {
    const scan = isAgentCheckId(old) ? await fetchAgentCheck(old).catch(() => null) : null;
    // A report never changes, so its site doesn't either.
    return scan
      ? Response.redirect(new URL(agentCheckPath(scan.report.url), request.url), 308)
      : Response.redirect(new URL("/agents/check", request.url), 307);
  }

  if (context.pathname !== "/agents/check") return;
  const url = context.searchParams.get("url");
  const id = context.cookies.get(AGENT_CHECK_REPORT_COOKIE);
  if (!url || !id) return;
  const scan = await fetchAgentCheck(id).catch(() => null);
  if (scan?.report.url !== url) return;
  context.data.set("agentCheckScan", scan);
  // The page now depends on this visitor's cookie.
  context.headers.set("cache-control", "private, no-store");
}
