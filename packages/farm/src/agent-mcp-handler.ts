/**
 * The protocol side of the default MCP server (`agent.mcp`, see `agent-mcp.ts`): stateless
 * Streamable HTTP with JSON responses, and three read-only tools over the app's public pages.
 * A small JSON-RPC implementation rather than the MCP SDK, so apps that never receive an
 * MCP request carry no SDK.
 *
 * Kept free of Node built-ins: the production server runs on edge runtimes too.
 */
import {
  FARM_DEFAULT_MCP_DESCRIPTION,
  FARM_DEFAULT_MCP_PROTOCOL_VERSIONS,
  FARM_DEFAULT_MCP_TOOLS,
  type FarmDefaultMCPPage,
} from "./agent-mcp";
import { stripFarmBasePath } from "./base-path";

const INSTRUCTIONS =
  "This server reads the site's public pages. Call list_pages or search_pages to find a page, " +
  "then read_page with its path to get the page as Markdown. It cannot change anything.";
// Tool arguments are a path or a short query; anything larger is not a request for this server.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 16;
const READ_TIMEOUT_MS = 30_000;

export interface FarmDefaultMCPContext {
  server: { name: string; version: string; title?: string };
  /** The app's public pages for this request's origin. */
  listPages: () => FarmDefaultMCPPage[] | Promise<FarmDefaultMCPPage[]>;
  /** Reads a Markdown URL anonymously; null when the page does not answer with Markdown. */
  readMarkdown: (url: string) => Promise<string | null>;
  basePath?: string;
}

type JSONRPCId = string | number | null;

interface JSONRPCError {
  code: number;
  message: string;
}

class FarmMCPRequestError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
  }
}

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;
// Transport-level failures, outside the JSON-RPC range, as the SDK's Streamable HTTP server sends them.
const TRANSPORT_ERROR = -32000;

/**
 * Answers one request to the default MCP endpoint: stateless Streamable HTTP, JSON
 * responses, no sessions, and no server-initiated stream (GET answers 405).
 */
export async function handleFarmDefaultMCPRequest(
  request: Request,
  context: FarmDefaultMCPContext,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "POST") {
    return transportError(405, "Method not allowed. Send MCP requests with POST.", {
      Allow: "POST",
    });
  }
  // A browser page on another origin must not drive the server (MCP's DNS-rebinding rule).
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(origin, request.url)) {
    return transportError(403, "Cross-origin requests are not allowed.");
  }
  const protocolHeader = request.headers.get("mcp-protocol-version");
  if (
    protocolHeader &&
    !(FARM_DEFAULT_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader.trim())
  ) {
    return transportError(
      400,
      `Unsupported MCP-Protocol-Version: ${protocolHeader.slice(0, 32)}. Supported: ${FARM_DEFAULT_MCP_PROTOCOL_VERSIONS.join(", ")}.`,
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(?:;|$)/i.test(contentType.trim())) {
    return transportError(415, "Content-Type must be application/json.");
  }

  const text = await readBody(request);
  if (text === null) return transportError(413, "The request body is too large.");
  let message: unknown;
  try {
    message = JSON.parse(text);
  } catch {
    return json(400, rpcError(null, { code: PARSE_ERROR, message: "Parse error." }));
  }

  if (Array.isArray(message)) {
    if (message.length === 0 || message.length > MAX_BATCH) {
      return json(
        400,
        rpcError(null, { code: INVALID_REQUEST, message: "Invalid batch of JSON-RPC messages." }),
      );
    }
    const replies = (
      await Promise.all(message.map((item) => answerMessage(item, request, context)))
    ).filter((reply) => reply !== undefined);
    return replies.length ? json(200, replies) : new Response(null, { status: 202 });
  }
  const reply = await answerMessage(message, request, context);
  return reply === undefined ? new Response(null, { status: 202 }) : json(200, reply);
}

/** One JSON-RPC message's reply, or undefined for a notification or a response. */
async function answerMessage(
  message: unknown,
  request: Request,
  context: FarmDefaultMCPContext,
): Promise<unknown> {
  if (!isRecord(message) || message.jsonrpc !== "2.0") {
    return rpcError(readId(message), { code: INVALID_REQUEST, message: "Invalid Request." });
  }
  const hasId = "id" in message;
  if (typeof message.method !== "string") {
    // A response to a server request this server never sends; nothing to answer.
    if (hasId && ("result" in message || "error" in message)) return undefined;
    return rpcError(readId(message), { code: INVALID_REQUEST, message: "Invalid Request." });
  }
  if (!hasId) return undefined; // Notifications, such as notifications/initialized.
  const id = readId(message);
  if (id === undefined) {
    return rpcError(null, { code: INVALID_REQUEST, message: "Invalid Request id." });
  }
  try {
    const result = await dispatch(message.method, message.params, request, context);
    return { jsonrpc: "2.0", id, result };
  } catch (error) {
    if (error instanceof FarmMCPRequestError) {
      return rpcError(id, { code: error.code, message: error.message });
    }
    return rpcError(id, { code: INTERNAL_ERROR, message: "Internal error." });
  }
}

async function dispatch(
  method: string,
  params: unknown,
  request: Request,
  context: FarmDefaultMCPContext,
): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = isRecord(params) ? params.protocolVersion : undefined;
      const protocolVersion =
        typeof requested === "string" &&
        (FARM_DEFAULT_MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : FARM_DEFAULT_MCP_PROTOCOL_VERSIONS[0];
      return {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: {
          name: context.server.name,
          version: context.server.version,
          ...(context.server.title ? { title: context.server.title } : {}),
          description: FARM_DEFAULT_MCP_DESCRIPTION,
        },
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: FARM_DEFAULT_MCP_TOOLS };
    case "tools/call":
      return callTool(params, request, context);
    default:
      throw new FarmMCPRequestError(METHOD_NOT_FOUND, `Method not found: ${method.slice(0, 64)}`);
  }
}

async function callTool(
  params: unknown,
  request: Request,
  context: FarmDefaultMCPContext,
): Promise<unknown> {
  if (!isRecord(params) || typeof params.name !== "string") {
    throw new FarmMCPRequestError(INVALID_PARAMS, "tools/call needs a tool name.");
  }
  const tool = FARM_DEFAULT_MCP_TOOLS.find(({ name }) => name === params.name);
  if (!tool) {
    throw new FarmMCPRequestError(INVALID_PARAMS, `Unknown tool: ${params.name.slice(0, 64)}`);
  }
  const args = params.arguments ?? {};
  // Argument problems are tool errors, so the model sees them and can correct the call.
  if (!isRecord(args)) return toolError("Arguments must be an object.");
  const allowed = new Set(Object.keys(tool.inputSchema.properties));
  const unknown = Object.keys(args).find((key) => !allowed.has(key));
  if (unknown) return toolError(`Unknown argument: ${unknown.slice(0, 64)}.`);

  if (tool.name === "list_pages") return pagesResult(await context.listPages());

  if (tool.name === "search_pages") {
    const query = args.query;
    if (typeof query !== "string" || !query.trim() || query.length > 200) {
      return toolError("query must be a non-empty string of at most 200 characters.");
    }
    const limit = args.limit ?? 10;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 50) {
      return toolError("limit must be a whole number from 1 to 50.");
    }
    return pagesResult(searchPages(await context.listPages(), query, limit));
  }

  const path = args.path;
  if (typeof path !== "string" || !path.trim() || path.length > 2048) {
    return toolError('path must be a page path such as "/about".');
  }
  const pagePath = toPagePath(path, request.url, context.basePath);
  const pages = await context.listPages();
  const page = pagePath ? pages.find((candidate) => candidate.path === pagePath) : undefined;
  if (!page) {
    return toolError(
      `No public page at ${JSON.stringify(path.slice(0, 200))}. Call list_pages for the pages this server can read.`,
    );
  }
  const markdown = await readWithTimeout(context.readMarkdown, page.markdownUrl);
  if (markdown === null) {
    return toolError(`${page.path} did not answer with Markdown. Try again later.`);
  }
  return { content: [{ type: "text", text: markdown }] };
}

function pagesResult(pages: FarmDefaultMCPPage[]) {
  const structured = {
    pages: pages.map(({ path, title, url, description }) => ({
      path,
      title,
      url,
      ...(description ? { description } : {}),
    })),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structured) }],
    structuredContent: structured,
  };
}

function toolError(text: string) {
  return { content: [{ type: "text", text }], isError: true };
}

function searchPages(
  pages: FarmDefaultMCPPage[],
  query: string,
  limit: number,
): FarmDefaultMCPPage[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 16);
  return pages
    .map((page) => {
      const title = page.title.toLowerCase();
      const rest = `${page.description ?? ""} ${page.path}`.toLowerCase();
      let score = 0;
      for (const term of terms) {
        if (title.includes(term)) score += 2;
        else if (rest.includes(term)) score += 1;
        else return null;
      }
      return { page, score };
    })
    .filter((match): match is { page: FarmDefaultMCPPage; score: number } => match !== null)
    .sort(
      (left, right) => right.score - left.score || left.page.path.localeCompare(right.page.path),
    )
    .slice(0, limit)
    .map(({ page }) => page);
}

/** A page path from what an agent passes: a path, a `.md` mirror path, or a same-origin URL. */
function toPagePath(input: string, requestUrl: string, basePath?: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim(), requestUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(requestUrl).origin) return null;
  let path = url.pathname;
  try {
    path = decodeURI(path);
  } catch {
    return null;
  }
  path = stripFarmBasePath(path, basePath);
  if (path === "/index.md") return "/";
  if (path.toLowerCase().endsWith(".md")) path = path.slice(0, -3) || "/";
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

async function readWithTimeout(
  read: (url: string) => Promise<string | null>,
  url: string,
): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(resolve, READ_TIMEOUT_MS, null);
  });
  try {
    return await Promise.race([read(url), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** The body as text, or null past the size limit. */
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    await request.body?.cancel().catch(() => {});
    return null;
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function isSameOrigin(origin: string, requestUrl: string): boolean {
  try {
    return new URL(origin).host === new URL(requestUrl).host;
  } catch {
    return false;
  }
}

function readId(message: unknown): JSONRPCId | undefined {
  if (!isRecord(message)) return null;
  const { id } = message;
  return typeof id === "string" || (typeof id === "number" && Number.isFinite(id)) || id === null
    ? id
    : undefined;
}

function rpcError(id: JSONRPCId | undefined, error: JSONRPCError) {
  return { jsonrpc: "2.0", id: id ?? null, error };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function transportError(
  status: number,
  message: string,
  headers: Record<string, string> = {},
): Response {
  const response = json(status, rpcError(null, { code: TRANSPORT_ERROR, message }));
  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
  return response;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
