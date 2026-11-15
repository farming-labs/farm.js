import { emitFarmEvent } from "./observability";

/**
 * Recognizes the client behind a request from what it declares: its User-Agent token, an
 * MCP or Web Bot Auth header, or a browser's fetch metadata.
 *
 * These are declarations, not proof of identity: any client can send them. Use
 * the result to understand traffic and tailor responses, never to grant access.
 */

export interface FarmAgentIdentity {
  family: "unknown" | "openai" | "anthropic" | "google" | "microsoft" | "perplexity" | "other";
  /**
   * `crawler` indexes or trains; `agent` fetches on a person's request; `harness` is a
   * coding agent or an MCP client.
   */
  category: "unknown" | "crawler" | "agent" | "harness";
  identity: "unknown" | "self-reported";
}

/** Any client, not only AI ones. See {@link classifyFarmClient}. */
export interface FarmClientIdentity {
  /** The vendor when Farm tracks it; `other` for an AI client from another vendor. */
  family: FarmAgentIdentity["family"];
  /**
   * The AI categories of {@link FarmAgentIdentity}, or `search` (search engine crawlers),
   * `preview` (link previews), `monitor` (uptime checks and cron), `bot` (any other declared
   * bot or headless browser), `script` (HTTP libraries and command-line tools) or `browser`.
   */
  category:
    | FarmAgentIdentity["category"]
    | "search"
    | "preview"
    | "monitor"
    | "bot"
    | "script"
    | "browser";
  identity: FarmAgentIdentity["identity"];
  /** The client's name from Farm's own list, such as `ClaudeBot`, `curl` or `Chrome`. */
  name?: string;
}

type Family = FarmClientIdentity["family"];
type Category = FarmClientIdentity["category"];

// [User-Agent token (a regular expression source), name, family, category]. AI tokens are the
// ones each vendor documents; Claude Code's web fetch sends `Claude-User (claude-code/<v>; …)`
// and Codex sends `codex_cli_rs/<v>` (or codex_exec, codex_vscode, …).
const CLIENT_TOKENS: [string, string, Family, Category][] = [
  ["ChatGPT-User", "ChatGPT-User", "openai", "agent"],
  ["OAI-SearchBot", "OAI-SearchBot", "openai", "crawler"],
  ["GPTBot", "GPTBot", "openai", "crawler"],
  ["codex[_-][a-z]+(?:[_-][a-z]+)*", "Codex", "openai", "harness"],
  ["Claude-User", "Claude-User", "anthropic", "agent"],
  ["Claude-SearchBot", "Claude-SearchBot", "anthropic", "crawler"],
  ["ClaudeBot", "ClaudeBot", "anthropic", "crawler"],
  ["claude-code", "Claude Code", "anthropic", "harness"],
  ["Perplexity-User", "Perplexity-User", "perplexity", "agent"],
  ["PerplexityBot", "PerplexityBot", "perplexity", "crawler"],
  ["Google-CloudVertexBot", "Google-CloudVertexBot", "google", "crawler"],
  ["MistralAI-User", "MistralAI-User", "other", "agent"],
  ["Meta-ExternalFetcher", "Meta-ExternalFetcher", "other", "agent"],
  ["Meta-ExternalAgent", "Meta-ExternalAgent", "other", "crawler"],
  ["Amazonbot", "Amazonbot", "other", "crawler"],
  ["DuckAssistBot", "DuckAssistBot", "other", "crawler"],
  ["CCBot", "CCBot", "other", "crawler"],
  ["Bytespider", "Bytespider", "other", "crawler"],
  ["Googlebot", "Googlebot", "google", "search"],
  ["Google-InspectionTool", "Google-InspectionTool", "google", "search"],
  ["bingbot", "Bingbot", "microsoft", "search"],
  ["Applebot", "Applebot", "unknown", "search"],
  ["DuckDuckBot", "DuckDuckBot", "unknown", "search"],
  ["YandexBot", "YandexBot", "unknown", "search"],
  ["Baiduspider", "Baiduspider", "unknown", "search"],
  ["PetalBot", "PetalBot", "unknown", "search"],
  ["BingPreview", "BingPreview", "microsoft", "preview"],
  ["facebookexternalhit", "facebookexternalhit", "unknown", "preview"],
  ["Slackbot-LinkExpanding", "Slackbot", "unknown", "preview"],
  ["Slackbot", "Slackbot", "unknown", "preview"],
  ["Twitterbot", "Twitterbot", "unknown", "preview"],
  ["Discordbot", "Discordbot", "unknown", "preview"],
  ["LinkedInBot", "LinkedInBot", "unknown", "preview"],
  ["TelegramBot", "TelegramBot", "unknown", "preview"],
  ["WhatsApp", "WhatsApp", "unknown", "preview"],
  ["UptimeRobot", "UptimeRobot", "unknown", "monitor"],
  ["vercel-cron", "Vercel Cron", "unknown", "monitor"],
  ["farmjs-clock", "Farm.js clock", "unknown", "monitor"],
  ["farmjs-infra-safe-fetch", "Farm.js Infra", "unknown", "bot"],
  ["FarmjsInfra-Discovery", "Farm.js Infra", "unknown", "bot"],
  ["GoogleOther", "GoogleOther", "google", "bot"],
  ["HeadlessChrome", "Headless Chrome", "unknown", "bot"],
  ["PhantomJS", "PhantomJS", "unknown", "bot"],
  ["Chrome-Lighthouse", "Lighthouse", "unknown", "bot"],
  ["Scrapy", "Scrapy", "unknown", "bot"],
  ["curl", "curl", "unknown", "script"],
  ["Wget", "Wget", "unknown", "script"],
  ["python-requests", "python-requests", "unknown", "script"],
  ["python-httpx", "python-httpx", "unknown", "script"],
  ["Python-urllib", "Python-urllib", "unknown", "script"],
  ["aiohttp", "aiohttp", "unknown", "script"],
  ["axios", "axios", "unknown", "script"],
  ["node-fetch", "node-fetch", "unknown", "script"],
  ["undici", "undici", "unknown", "script"],
  // Node's built-in fetch sends exactly `node`.
  ["node", "Node.js", "unknown", "script"],
  ["Bun", "Bun", "unknown", "script"],
  ["Deno", "Deno", "unknown", "script"],
  ["Go-http-client", "Go", "unknown", "script"],
  ["okhttp", "OkHttp", "unknown", "script"],
  ["Java-http-client", "Java", "unknown", "script"],
  ["Java", "Java", "unknown", "script"],
  ["Apache-HttpClient", "Apache HttpClient", "unknown", "script"],
  ["PostmanRuntime", "Postman", "unknown", "script"],
  ["insomnia", "Insomnia", "unknown", "script"],
  ["HTTPie", "HTTPie", "unknown", "script"],
  ["libwww-perl", "libwww-perl", "unknown", "script"],
  ["Ruby", "Ruby", "unknown", "script"],
  ["got", "got", "unknown", "script"],
];

// One pass over the header: group i + 1 is CLIENT_TOKENS[i].
const CLIENT_PATTERN = new RegExp(
  `(?:^|[\\s;(])(?:${CLIENT_TOKENS.map(([token]) => `(${token})`).join("|")})(?=[/\\s;)]|$)`,
  "gi",
);

// The more specific category wins when one vendor's tokens appear together, such as
// Claude Code's `Claude-User (claude-code/…)`.
const PRECEDENCE: Category[] = [
  "harness",
  "agent",
  "crawler",
  "search",
  "preview",
  "monitor",
  "bot",
  "script",
];
const AI_CATEGORIES = new Set<Category>(["agent", "crawler", "harness"]);

const BROWSERS: [RegExp, string][] = [
  [/\bEdg(?:e|A|iOS)?\//, "Edge"],
  [/\bOPR\//, "Opera"],
  [/\bSamsungBrowser\//, "Samsung Internet"],
  [/\b(?:Firefox|FxiOS)\//, "Firefox"],
  [/\b(?:Chrome|CriOS)\//, "Chrome"],
  [/\bVersion\/[\d.]+ (?:Mobile\/\w+ )?Safari\//, "Safari"],
];
const BOT_WORD = /(?:bot|crawler|spider|scraper)(?:[/\s;)_-]|$)/i;

const UNKNOWN: FarmAgentIdentity = { family: "unknown", category: "unknown", identity: "unknown" };

type TokenMatch = { name: string; family: Family; category: Category };

/** The most specific token in a User-Agent, `null` for none, `false` for two vendors at once. */
function matchToken(userAgent: string): TokenMatch | null | false {
  let best: TokenMatch | null = null;
  let vendor: Family | undefined;
  for (const match of userAgent.matchAll(CLIENT_PATTERN)) {
    const index = match.findIndex((group, i) => i > 0 && group !== undefined) - 1;
    const [, name, family, category] = CLIENT_TOKENS[index]!;
    // Conflicting vendors are ambiguous, rather than a reason to guess one.
    if (family !== "unknown") {
      if (vendor && vendor !== family) return false;
      vendor = family;
    }
    if (!best || PRECEDENCE.indexOf(category) < PRECEDENCE.indexOf(best.category))
      best = { name, family, category };
  }
  return best;
}

/** Classifies a User-Agent header value. Ambiguous or unknown values are `unknown`. */
export function classifyFarmAgent(userAgent: string | null | undefined): FarmAgentIdentity {
  const match = matchToken((userAgent ?? "").slice(0, 2048));
  if (match && AI_CATEGORIES.has(match.category)) {
    const { family, category } = match;
    return {
      family,
      category: category as FarmAgentIdentity["category"],
      identity: "self-reported",
    };
  }
  return { ...UNKNOWN };
}

/**
 * Classifies the client behind a request: an AI agent or crawler, a coding agent or MCP
 * client, a search crawler, a link preview, a monitor, another bot, a script, or a browser.
 * A client that declares none of these, or two vendors at once, is `unknown`.
 */
export function classifyFarmClient(request: Request): FarmClientIdentity {
  const { headers } = request;
  const userAgent = (headers.get("user-agent") ?? "").slice(0, 2048);
  const match = matchToken(userAgent);
  if (match === false) return { ...UNKNOWN };
  if (match && AI_CATEGORIES.has(match.category)) return declared(match);
  // ChatGPT agent browses with a Chrome user-agent and signs its requests (Web Bot Auth).
  if (/"https:\/\/chatgpt\.com\/?"/i.test(headers.get("signature-agent") ?? ""))
    return declared({ name: "ChatGPT agent", family: "openai", category: "agent" });
  if (isMcpRequest(request))
    return declared({ name: "MCP client", family: "unknown", category: "harness" });
  if (match) return declared(match);
  const browser = browserName(userAgent);
  // Browsers send Sec-Fetch-Site and Sec-Fetch-Dest with every request from a secure context.
  // Node's fetch sends neither, so a browser user-agent without them is another client.
  if (browser !== undefined && headers.has("sec-fetch-site") && headers.has("sec-fetch-dest"))
    return declared({ name: browser, family: "unknown", category: "browser" });
  if (BOT_WORD.test(userAgent) || userAgent.includes("://"))
    return declared({ name: "", family: "unknown", category: "bot" });
  return { ...UNKNOWN };
}

function declared({ name, family, category }: TokenMatch): FarmClientIdentity {
  return { family, category, identity: "self-reported", ...(name ? { name } : {}) };
}

/**
 * MCP's Streamable HTTP transport: every request after initialize names the protocol version
 * or session, and every POST accepts both JSON and an event stream.
 */
function isMcpRequest(request: Request): boolean {
  const { headers } = request;
  if (headers.has("mcp-protocol-version") || headers.has("mcp-session-id")) return true;
  const accept = headers.get("accept") ?? "";
  return (
    request.method === "POST" &&
    /(?:^|[\s,])application\/json(?:[\s;,]|$)/i.test(accept) &&
    /(?:^|[\s,])text\/event-stream(?:[\s;,]|$)/i.test(accept)
  );
}

/** The browser a user-agent names, `""` for an unnamed one, `undefined` for none. */
function browserName(userAgent: string): string | undefined {
  // Modern browsers never say "compatible;" or carry a URL; bots dressed as browsers do.
  if (!userAgent.startsWith("Mozilla/5.0 (") || /compatible;|:\/\//i.test(userAgent)) return;
  return BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1] ?? "";
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
