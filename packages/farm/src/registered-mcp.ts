/**
 * MCP servers that a docs runtime serves inside the app and lists with `registerFarmMCPServer`,
 * seen the way Farm sees the servers `@farm.js/mcp` mounts: the manifest lists their tools,
 * and each tool call they answer emits `mcp.tool.complete`. Farm asks and watches over MCP
 * itself, in process, so the runtime needs no Farm-specific hooks.
 *
 * Kept free of Node built-ins: the production server runs on edge runtimes too.
 */
import type { FarmAppManifestServer, FarmAppManifestTool } from "./app-manifest";
import { applyFarmBasePath, stripFarmBasePath } from "./base-path";
import { _listFarmRegisteredMCPServers, type FarmRegisteredMCPServer } from "./mcp-catalog";
import { emitFarmEvent } from "./observability";

type Handle = (request: Request) => Promise<Response | null>;
type JSONObject = Record<string, unknown>;
type RequestId = string | number;

/** The tool names Farm reports, as `@farm.js/mcp` and Farm Infra accept them. */
const TOOL_NAME = /^[a-zA-Z0-9_.:/-]{1,128}$/;
/** A request body larger than this goes unobserved. MCP requests are small. */
const MAX_REQUEST_BYTES = 1024 * 1024;
/** Reading a response for its outcomes stops after this much. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
/** The most calls one batched request reports. */
const MAX_CALLS = 32;
/** The most tools one server lists in the manifest, across at most MAX_PAGES pages. */
const MAX_TOOLS = 500;
const MAX_PAGES = 10;
/** A server that hasn't listed its tools within this long is left out of the manifest. */
const LIST_TIMEOUT_MS = 5_000;
/** The largest schema the manifest keeps, and its deepest nesting, as Farm Infra reads them. */
const MAX_SCHEMA_BYTES = 64 * 1024;
const MAX_SCHEMA_DEPTH = 32;
/** A server path the manifest lists: plain segments, at most 256 characters. */
const MANIFEST_PATH = /^(?=.{1,256}$)(?:\/[a-zA-Z0-9_.:[\]()*-]+)+$/;

type ServedServer = FarmRegisteredMCPServer & { readonly path: string };

const isObject = (value: unknown): value is JSONObject =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isRequestId = (value: unknown): value is RequestId =>
  typeof value === "string" || typeof value === "number";

/**
 * The registered server a request to the docs handler reaches: the one at its path, or else the
 * handler's only server. A docs runtime also answers MCP at aliases of the endpoint it registers
 * (`@farming-labs/docs` at `/mcp` and `/.well-known/mcp`), and a tools/call it answers there is
 * a call to that server. Only an answer with the call's ID reports it, so another POST the
 * handler serves never does.
 */
function servedAt(pathname: string, basePath: string | undefined): ServedServer | undefined {
  const path = stripFarmBasePath(pathname, basePath);
  const normalized = path.length > 1 ? path.replace(/\/+$/, "") : path;
  const servers = _listFarmRegisteredMCPServers().filter(
    (server): server is ServedServer => server.path !== undefined,
  );
  return (
    servers.find((server) => server.path === normalized) ??
    (servers.length === 1 ? servers[0] : undefined)
  );
}

async function readText(body: ReadableStream<Uint8Array>, limit: number): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > limit) throw new RangeError("The body is larger than Farm reads.");
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Each JSON-RPC message in a Streamable HTTP response body: JSON, or server-sent events. */
function parseMessages(text: string, eventStream: boolean): unknown[] {
  const parse = (json: string) => {
    try {
      const value: unknown = JSON.parse(json);
      return Array.isArray(value) ? value : [value];
    } catch {
      return [];
    }
  };
  if (!eventStream) return parse(text);
  return text.split(/\r?\n\r?\n/).flatMap((event) => {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5));
    return data.length ? parse(data.join("\n")) : [];
  });
}

const isEventStream = (response: Response) =>
  response.headers.get("content-type")?.toLowerCase().includes("text/event-stream") ?? false;

/** The tools/call requests in one POST to a registered MCP server, and when it arrived. */
export interface FarmRegisteredMCPCalls {
  readonly server: ServedServer;
  readonly calls: readonly { readonly id: RequestId; readonly tool: string }[];
  readonly startedAt: number;
}

/**
 * @internal The tools/call requests in a POST to the docs handler for one of its registered MCP
 * servers (see servedAt), read from a clone so `request` keeps its body. Anything else, including a body that isn't JSON-RPC or is
 * larger than 1 MiB, is not observed.
 */
export async function _readFarmRegisteredMCPCalls(
  request: Request,
  basePath: string | undefined,
): Promise<FarmRegisteredMCPCalls | undefined> {
  if (request.method !== "POST" || !request.body) return undefined;
  const server = servedAt(new URL(request.url).pathname, basePath);
  if (!server) return undefined;
  if (!request.headers.get("content-type")?.toLowerCase().includes("json")) return undefined;
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) return undefined;
  const startedAt = performance.now();
  let messages: unknown[];
  try {
    // A clone tees the body, so the handler still reads all of it.
    messages = parseMessages(await readText(request.clone().body!, MAX_REQUEST_BYTES), false);
  } catch {
    return undefined;
  }
  const calls = messages.slice(0, MAX_CALLS).flatMap((message) => {
    if (!isObject(message) || message.method !== "tools/call" || !isRequestId(message.id)) {
      return [];
    }
    const tool = isObject(message.params) ? message.params.name : undefined;
    return typeof tool === "string" && TOOL_NAME.test(tool) ? [{ id: message.id, tool }] : [];
  });
  return calls.length ? { server, calls, startedAt } : undefined;
}

/**
 * @internal Hands back `response` for sending, and emits `mcp.tool.complete` for each observed
 * call it answers with a result: `error` when the result says `isError`. A JSON-RPC error means
 * the tool never ran (an unknown name, invalid arguments), and a call the response never answers
 * is not reported. Call it inside the request, so analytics ties each call to it; `waitUntil`
 * keeps a serverless function alive until the response has been read.
 */
export function _observeFarmRegisteredMCPResponse(
  response: Response,
  observed: FarmRegisteredMCPCalls | undefined,
  waitUntil?: (promise: Promise<unknown>) => void,
): Response {
  if (!observed || !response.ok || !response.body) return response;
  const eventStream = isEventStream(response);
  if (!eventStream && !response.headers.get("content-type")?.toLowerCase().includes("json")) {
    return response;
  }
  const [sent, read] = response.body.tee();
  const done = reportOutcomes(read, eventStream, observed);
  waitUntil?.(done);
  return new Response(sent, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function reportOutcomes(
  body: ReadableStream<Uint8Array>,
  eventStream: boolean,
  { server, calls, startedAt }: FarmRegisteredMCPCalls,
): Promise<void> {
  const pending = new Map(calls.map((call) => [call.id, call.tool]));
  const answer = (message: unknown) => {
    if (!isObject(message) || !isRequestId(message.id) || !isObject(message.result)) return;
    const tool = pending.get(message.id);
    if (tool === undefined) return;
    pending.delete(message.id);
    const outcome = message.result.isError === true ? "error" : "success";
    emitFarmEvent({
      type: "mcp.tool.complete",
      level: outcome === "error" ? "error" : "info",
      route: server.path,
      server: server.name,
      tool,
      outcome,
      durationMs: Math.max(0, performance.now() - startedAt),
    });
  };
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let size = 0;
  try {
    while (pending.size) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) return;
      buffered += decoder.decode(value, { stream: true });
      if (!eventStream) continue;
      // Each complete event answers as it arrives, so a long stream reports early calls early.
      buffered = buffered.replace(/\r\n/g, "\n");
      const end = buffered.lastIndexOf("\n\n");
      if (end === -1) continue;
      for (const message of parseMessages(buffered.slice(0, end), true)) answer(message);
      buffered = buffered.slice(end + 2);
    }
    buffered += decoder.decode();
    for (const message of parseMessages(buffered, eventStream)) answer(message);
  } catch {
    // The response failed while streaming; its unanswered calls are not reported.
  } finally {
    reader.cancel().catch(() => {});
  }
}

const singleLine = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  // oxlint-disable-next-line no-control-regex -- refuses control characters.
  !/[\u0000-\u001f\u007f]/.test(value);
const paragraph = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length <= max &&
  // oxlint-disable-next-line no-control-regex -- refuses control characters but line breaks.
  !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);

function boundedSchema(value: unknown): JSONObject | undefined {
  if (!isObject(value)) return undefined;
  const depth = (node: unknown, level: number): boolean =>
    level <= MAX_SCHEMA_DEPTH &&
    (!node ||
      typeof node !== "object" ||
      Object.values(node as object).every((child) => depth(child, level + 1)));
  if (!depth(value, 0)) return undefined;
  return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_SCHEMA_BYTES
    ? value
    : undefined;
}

/**
 * A listed tool as the manifest describes it. The runtime's tools have no app endpoint behind
 * them, so they are standalone tools like `defineTool`'s, as the default server's are. A field
 * the manifest can't carry (a long title, an oversized schema) is left out, never the manifest.
 */
function manifestTool(input: unknown): FarmAppManifestTool | undefined {
  if (!isObject(input) || typeof input.name !== "string" || !TOOL_NAME.test(input.name)) {
    return undefined;
  }
  const annotations = isObject(input.annotations) ? input.annotations : {};
  const title = input.title ?? annotations.title;
  const hints = Object.fromEntries(
    (["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const)
      .filter((hint) => typeof annotations[hint] === "boolean")
      .map((hint) => [hint, annotations[hint]]),
  );
  const inputSchema = boundedSchema(input.inputSchema);
  const outputSchema = boundedSchema(input.outputSchema);
  return {
    name: input.name,
    ...(singleLine(title, 200) ? { title } : {}),
    ...(paragraph(input.description, 2000) ? { description: input.description } : {}),
    source: "defineTool",
    ...hints,
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
  };
}

type Listing =
  | { authorization: "none"; tools: FarmAppManifestTool[] }
  | { authorization: "required" };

async function listTools(
  handle: Handle,
  url: URL,
  signal: AbortSignal,
): Promise<Listing | undefined> {
  const tools: FarmAppManifestTool[] = [];
  const names = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = await handle(
      new Request(url, {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: page + 1,
          method: "tools/list",
          params: cursor ? { cursor } : {},
        }),
        signal,
      }),
    );
    if (!response) return undefined;
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => {});
      return page === 0 ? { authorization: "required" } : undefined;
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => {});
      return undefined;
    }
    const answer = parseMessages(
      await readText(response.body, MAX_RESPONSE_BYTES),
      isEventStream(response),
    ).find((message) => isObject(message) && message.id === page + 1);
    const result = isObject(answer) && isObject(answer.result) ? answer.result : undefined;
    if (!result || !Array.isArray(result.tools)) return undefined;
    for (const tool of result.tools.map(manifestTool)) {
      if (!tool || names.has(tool.name) || tools.length >= MAX_TOOLS) continue;
      names.add(tool.name);
      tools.push(tool);
    }
    cursor =
      typeof result.nextCursor === "string" && result.nextCursor ? result.nextCursor : undefined;
    if (!cursor || tools.length >= MAX_TOOLS) break;
  }
  return { authorization: "none", tools };
}

const LISTINGS = new WeakMap<FarmRegisteredMCPServer, Promise<Listing | undefined>>();

/**
 * @internal The registered MCP servers `handle` serves in this app, each with the tools it lists
 * to an anonymous client: JSON-RPC tools/list requests through `handle`, in process. A server
 * behind a guard written for its path, or one that answers 401 or 403, is listed by identity
 * only, like a Farm server with `authorize`. One that doesn't answer is left out. With `cache`
 * (a production build, whose content can't change), a server's tools are read once per process.
 */
export async function _listFarmRegisteredMCPServerTools(
  handle: Handle,
  request: Request,
  options: {
    basePath: string | undefined;
    guardCoversPath?: (path: string) => boolean;
    cache?: boolean;
  },
): Promise<FarmAppManifestServer[]> {
  // Only a server the manifest can name: a short name and version, and a path of plain segments.
  const servers = _listFarmRegisteredMCPServers().filter(
    (server): server is ServedServer =>
      server.path !== undefined &&
      MANIFEST_PATH.test(server.path) &&
      singleLine(server.name, 128) &&
      singleLine(server.version, 64),
  );
  const listings = await Promise.all(
    servers.map((server): Promise<Listing | undefined> => {
      if (options.guardCoversPath?.(server.path)) {
        return Promise.resolve({ authorization: "required" });
      }
      const cached = options.cache ? LISTINGS.get(server) : undefined;
      if (cached) return cached;
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const listing = Promise.race([
        listTools(
          handle,
          new URL(applyFarmBasePath(server.path, options.basePath), request.url),
          controller.signal,
        ),
        new Promise<undefined>((resolve) => {
          timer = setTimeout(() => {
            controller.abort();
            resolve(undefined);
          }, LIST_TIMEOUT_MS);
        }),
      ])
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
      if (options.cache) {
        LISTINGS.set(server, listing);
        // Only a server that answered keeps its listing; the next manifest asks again.
        void listing.then((value) => {
          if (!value && LISTINGS.get(server) === listing) LISTINGS.delete(server);
        });
      }
      return listing;
    }),
  );
  return servers.flatMap((server, index): FarmAppManifestServer[] => {
    const listing = listings[index];
    if (!listing) return [];
    return [
      {
        name: server.name,
        version: server.version,
        path: server.path,
        authorization: listing.authorization,
        resources: [],
        prompts: [],
        tools: listing.authorization === "none" ? listing.tools : [],
      },
    ];
  });
}
