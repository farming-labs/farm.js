import { emitFarmEvent } from "./observability";

/**
 * Recognizes AI agents and crawlers by the token they put in User-Agent.
 *
 * These are declarations, not proof of identity: any client can send them. Use
 * the result to understand traffic and tailor responses, never to grant access.
 */

export interface FarmAgentIdentity {
  family: "unknown" | "openai" | "anthropic" | "google" | "microsoft" | "perplexity" | "other";
  /** `crawler` indexes or trains; `agent` fetches on a person's request. */
  category: "unknown" | "crawler" | "agent" | "harness";
  identity: "unknown" | "self-reported";
}

const AGENT_TOKENS: [string, FarmAgentIdentity["family"], FarmAgentIdentity["category"]][] = [
  ["ChatGPT-User", "openai", "agent"],
  ["OAI-SearchBot", "openai", "crawler"],
  ["GPTBot", "openai", "crawler"],
  ["Claude-User", "anthropic", "agent"],
  ["Claude-SearchBot", "anthropic", "crawler"],
  ["ClaudeBot", "anthropic", "crawler"],
  ["Perplexity-User", "perplexity", "agent"],
  ["PerplexityBot", "perplexity", "crawler"],
  ["CCBot", "other", "crawler"],
  ["Bytespider", "other", "crawler"],
  ["Meta-ExternalAgent", "other", "crawler"],
];

const AGENT_PATTERNS = AGENT_TOKENS.map(([token, family, category]) => ({
  pattern: new RegExp(`(?:^|[\\s;(])${token}(?=[/\\s;)]|$)`, "i"),
  family,
  category,
}));

const UNKNOWN: FarmAgentIdentity = { family: "unknown", category: "unknown", identity: "unknown" };

/** Classifies a User-Agent header value. Ambiguous or unknown values are `unknown`. */
export function classifyFarmAgent(userAgent: string | null | undefined): FarmAgentIdentity {
  const value = (userAgent ?? "").slice(0, 2048);
  const matches = AGENT_PATTERNS.filter(({ pattern }) => pattern.test(value));
  // Conflicting tokens are ambiguous, rather than a reason to guess a vendor.
  if (matches.length === 1) {
    const { family, category } = matches[0]!;
    return { family, category, identity: "self-reported" };
  }
  return { ...UNKNOWN };
}

/** Marks Farm's own reads, such as llms-full.txt reading each page, which are not agent traffic. */
export const FARM_INTERNAL_READ_HEADER = "x-farm-internal-read";

/**
 * Reports a read of an agent surface as an `agent.read` event, with the agent
 * the request declares. The route is the path only, never the query string.
 */
export function emitFarmAgentRead(
  request: Request,
  surface: "markdown" | "llms" | "llms-full" | "api-catalog" | "ai-catalog" | "mcp-server-card",
  status: number,
  view?: "outline" | "section" | "parts" | "actions",
): void {
  if (request.headers.has(FARM_INTERNAL_READ_HEADER)) return;
  let route: string;
  try {
    route = new URL(request.url).pathname;
  } catch {
    return;
  }
  emitFarmEvent({
    type: "agent.read",
    surface,
    route,
    ...(view ? { view } : {}),
    status,
    agent: classifyFarmAgent(request.headers.get("user-agent")),
  });
}
