/**
 * `/.well-known/farmjs.json`: one document describing a Farm app, so tools can discover it
 * instead of each rebuilding the picture: Farm's version, renderer and packages, the app's
 * MCP servers with every tool (however it was defined) and its schemas, their resources and
 * prompts, its WebMCP browser tools, its integrations, its agent surfaces and its plugins.
 * Never environment values, settings or secrets.
 *
 * Anyone may read it, in development and production alike (`agent.manifest: false` turns it
 * off). The public view lists only what an anonymous client could already find: an MCP
 * server that requires `authorize` shows its identity but not its tools, resources or
 * prompts, and endpoint tools leave out their HTTP route. A request Farm Infra signed for
 * the app's `FARMJS_API_KEY` gets the full view. Kept free of Node built-ins: Web Crypto only.
 */
import { FARM_DEFAULT_MCP_TOOLS } from "./agent-mcp";
import type { FarmAppManifestWebMCPTool } from "./app-manifest-webmcp";
import { _listFarmMCPCatalogs, type FarmMCPCatalogDetails } from "./mcp-catalog";
import { createFarmWeakETag, matchesFarmIfNoneMatch } from "./server-http";
import { FARM_VERSION } from "./version";

export const FARM_APP_MANIFEST_PATH = "/.well-known/farmjs.json";
/**
 * @deprecated Where Farm 0.1.34 served the manifest. Still answered the same way, so Farm Infra
 * and tools that read it there keep working; use {@link FARM_APP_MANIFEST_PATH}.
 */
export const FARM_APP_MANIFEST_LEGACY_PATH = "/.well-known/farmjs";

/** Whether `pathname` (without the app's basePath) is where the manifest is served. */
export function isFarmAppManifestPath(pathname: string): boolean {
  return pathname === FARM_APP_MANIFEST_PATH || pathname === FARM_APP_MANIFEST_LEGACY_PATH;
}
/** Farm Infra signs manifest requests in this header: `t=<unix seconds>, v2=<hex>`. */
export const FARM_INFRA_SIGNATURE_HEADER = "farmjs-infra-signature";

/**
 * `v2` signs the requested host and path with the time, so a signature read off one app can't
 * unlock another app sharing the key. `v1` (time only) is no longer accepted.
 */
const SIGNED_PURPOSE = "farmjs-manifest-v2";
const SIGNATURE_WINDOW_SECONDS = 300;

export type FarmAppManifestToolSource = "endpoint" | "defineTool" | "serverFunction";

export interface FarmAppManifestTool {
  name: string;
  title?: string;
  description?: string;
  /** How the app defined it: an API endpoint, `defineTool`, or a server function. */
  source: FarmAppManifestToolSource;
  /** The endpoint's method and route, for `source: "endpoint"`. Only in Farm Infra's view. */
  method?: string;
  path?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  /** JSON Schemas, when the server published them (`@farm.js/mcp` does). */
  inputSchema?: Readonly<Record<string, unknown>>;
  outputSchema?: Readonly<Record<string, unknown>>;
}

type ServerDetails = NonNullable<FarmMCPCatalogDetails>;

export interface FarmAppManifest {
  schemaVersion: 1;
  app: { farm: string; renderer: string; basePath: string; build: string };
  /** Installed versions of the app's `@farm.js/*` and `@farming-labs/*` packages. */
  packages: Record<string, string>;
  mcp: {
    servers: {
      name: string;
      version: string;
      path: string;
      /**
       * `"required"` when the server runs `authorize`: an anonymous client lists nothing,
       * so the public view leaves `tools`, `resources` and `prompts` empty.
       */
      authorization: "none" | "required";
      tools: FarmAppManifestTool[];
      resources: NonNullable<ServerDetails["resources"]>;
      prompts: NonNullable<ServerDetails["prompts"]>;
    }[];
  };
  /** Browser tools from `@farm.js/webmcp`, read from the app's source. */
  webmcp: { enabled: boolean; tools: FarmAppManifestWebMCPTool[] };
  /** The app's integrations: which slot each fills and which provider, never their config. */
  integrations: { key: string; category: string; type: string }[];
  agent: { apiCatalog: string | null; llmsTxt: boolean; openapi: string | null };
  plugins: string[];
}

/** What the manifest reads from config; serializable, so a production build embeds it. */
export interface FarmAppManifestInput {
  renderer: string;
  basePath: string;
  /** The build's ID, or "development". */
  build: string;
  packages: Record<string, string>;
  webmcp: FarmAppManifest["webmcp"];
  integrations: FarmAppManifest["integrations"];
  agent: FarmAppManifest["agent"];
  plugins: string[];
  /**
   * `analytics: false` turns off Farm Infra's signed view: the app talks to no Farm Infra.
   * The public manifest is still served; `agent.manifest: false` turns that off.
   */
  analytics: boolean;
  /**
   * The default read-only MCP server (`agent.mcp`) while the app would serve it. Set by the
   * server at runtime, not serialized: it answers only while no other MCP server is listed.
   */
  defaultMCP?: () => { name: string; version: string; path: string } | undefined;
  /**
   * Whether a guard written for a path (middleware, an integration's `protectedRoutes`)
   * covers an MCP server's endpoint. Set by the server at runtime: such a server is listed
   * as requiring authorization, without its tools, resources or prompts, in the public view.
   */
  guardCoversPath?: (path: string) => boolean;
}

export function resolveFarmAppManifestInput(
  config: {
    basePath?: string;
    renderer?: { name: string };
    analytics?: boolean;
    plugins?: readonly { name: string }[];
    agent?: { apiCatalog?: boolean; llmsTxt?: boolean | { enabled?: boolean } };
    openapi?: { enabled?: boolean; specRoute?: string | false };
    integrations?: Readonly<
      Record<string, { category?: string; slot?: string; type?: string } | undefined>
    >;
  },
  extra: {
    build: string;
    packages: Record<string, string>;
    /** From collectFarmWebMCPTools; only read when the webmcp plugin is on. */
    webmcpTools?: FarmAppManifestWebMCPTool[];
  },
): FarmAppManifestInput {
  const llms = config.agent?.llmsTxt;
  const plugins = (config.plugins ?? []).map(({ name }) => name);
  const webmcp = plugins.includes("farm:webmcp");
  return {
    renderer: config.renderer?.name ?? "react",
    basePath: config.basePath || "/",
    build: extra.build,
    packages: extra.packages,
    webmcp: { enabled: webmcp, tools: webmcp ? (extra.webmcpTools ?? []) : [] },
    integrations: Object.entries(config.integrations ?? {}).flatMap(([key, integration]) => {
      const category = integration?.category ?? integration?.slot;
      return integration && category && integration.type
        ? [{ key, category, type: integration.type }]
        : [];
    }),
    agent: {
      apiCatalog: config.agent?.apiCatalog ? "/.well-known/api-catalog" : null,
      llmsTxt:
        llms === true || (typeof llms === "object" && llms !== null && llms.enabled !== false),
      openapi:
        config.openapi?.enabled && config.openapi.specRoute ? config.openapi.specRoute : null,
    },
    plugins,
    analytics: config.analytics !== false,
  };
}

const SOURCES = {
  endpoint: "endpoint",
  standalone: "defineTool",
  serverFunction: "serverFunction",
} as const;

/**
 * The manifest now: the static input plus the MCP tools the running servers published.
 * `full` is Farm Infra's view, with every server's catalog and each endpoint tool's route.
 */
export function createFarmAppManifest(
  input: FarmAppManifestInput,
  { full = false }: { full?: boolean } = {},
): FarmAppManifest {
  const manifest: FarmAppManifest = {
    schemaVersion: 1,
    app: {
      farm: FARM_VERSION,
      renderer: input.renderer,
      basePath: input.basePath,
      build: input.build,
    },
    packages: input.packages,
    mcp: {
      servers: _listFarmMCPCatalogs().map(({ server, tools, details }) => {
        // A server that didn't say it's public (an older @farm.js/mcp) counts as protected,
        // as does one behind a guard written for its path: anonymous clients cannot list it.
        const open = details?.public === true && !input.guardCoversPath?.(server.path);
        const listed = full || open;
        return {
          name: server.name,
          version: server.version,
          path: server.path,
          authorization: open ? "none" : "required",
          resources: listed ? [...(details?.resources ?? [])] : [],
          prompts: listed ? [...(details?.prompts ?? [])] : [],
          tools: (listed ? tools : []).map((tool) => {
            const schemas = details?.schemas?.[tool.name];
            const hints = Object.fromEntries(
              (["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const)
                .filter((hint) => typeof tool[hint] === "boolean")
                .map((hint) => [hint, tool[hint]]),
            );
            return {
              name: tool.name,
              ...(tool.title ? { title: tool.title } : {}),
              ...(tool.description ? { description: tool.description } : {}),
              source: SOURCES[tool.kind],
              // MCP clients never see the route behind a tool; only Infra's view names it.
              ...(full && tool.kind === "endpoint" ? { method: tool.method, path: tool.path } : {}),
              ...hints,
              ...(schemas ? { inputSchema: schemas.input } : {}),
              ...(schemas?.output ? { outputSchema: schemas.output } : {}),
            };
          }),
        };
      }),
    },
    webmcp: input.webmcp,
    integrations: input.integrations,
    agent: input.agent,
    plugins: input.plugins,
  };
  manifest.mcp.servers.push(...listDefaultServer(input));
  return manifest;
}

/** The default server lists its tools to anyone: it answers anonymous clients. */
function listDefaultServer(input: FarmAppManifestInput): FarmAppManifest["mcp"]["servers"] {
  const server = input.defaultMCP?.();
  if (!server) return [];
  return [
    {
      name: server.name,
      version: server.version,
      path: server.path,
      authorization: "none",
      resources: [],
      prompts: [],
      tools: FARM_DEFAULT_MCP_TOOLS.map((tool) => ({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        // Standalone tools with no endpoint behind them, like defineTool's.
        source: "defineTool",
        ...tool.annotations,
        inputSchema: tool.inputSchema,
        ...("outputSchema" in tool ? { outputSchema: tool.outputSchema } : {}),
      })),
    },
  ];
}

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

async function sha256Hex(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmacHex(secret: string, message: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
}

function sameHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++)
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}

/** The host and path a signature is bound to: the scheme is left out, proxies often rewrite it. */
function signedTarget(url: string | URL) {
  const { host, pathname } = new URL(url);
  return `${host}${pathname}`;
}

/**
 * Signs a manifest request for `url` the way Farm Infra does. Infra stores only the SHA-256 of
 * a key, so the HMAC secret is that hash: the app derives it from its own key, Infra already
 * has it.
 */
export async function signFarmInfraManifestRequest(
  keyHash: string,
  url: string | URL,
  now = Date.now(),
) {
  const timestamp = Math.floor(now / 1000);
  const message = `${SIGNED_PURPOSE}\n${timestamp}\n${signedTarget(url)}`;
  return `t=${timestamp}, v2=${await hmacHex(keyHash, message)}`;
}

/** True when the header carries a fresh signature for this key and URL. Any `v2` may match. */
export async function verifyFarmInfraManifestSignature(
  header: string | null,
  key: string,
  url: string | URL,
  now = Date.now(),
): Promise<boolean> {
  if (!header || header.length > 2048) return false;
  const parts = header.split(",").map((part) => part.trim());
  const timestamp = Number(
    /^t=(\d{1,12})$/.exec(parts.find((part) => part.startsWith("t=")) ?? "")?.[1],
  );
  if (!Number.isSafeInteger(timestamp)) return false;
  if (Math.abs(now / 1000 - timestamp) > SIGNATURE_WINDOW_SECONDS) return false;
  const signatures = parts
    .filter((part) => part.startsWith("v2="))
    .map((part) => part.slice(3))
    .filter((value) => /^[0-9a-f]{64}$/.test(value));
  if (!signatures.length || signatures.length > 8) return false;
  const message = `${SIGNED_PURPOSE}\n${timestamp}\n${signedTarget(url)}`;
  const expected = await hmacHex(await sha256Hex(key), message);
  return signatures.some((signature) => sameHex(signature, expected));
}

type Env = Record<string, string | undefined>;

function processEnv(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

/** Public, read-only metadata, like the AI catalog: any origin may read it. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": `If-None-Match, ${FARM_INFRA_SIGNATURE_HEADER}`,
  "access-control-expose-headers": "ETag",
};

/**
 * Answers `/.well-known/farmjs.json` for anyone. A request Farm Infra signed for the app's
 * `FARMJS_API_KEY` gets the full view, unless `analytics` is off; any other read gets the
 * public one.
 */
export async function createFarmAppManifestResponse(
  request: Request,
  input: FarmAppManifestInput,
  options: { env?: Env } = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS", "content-type": "text/plain" },
    });
  }
  const signature = request.headers.get(FARM_INFRA_SIGNATURE_HEADER);
  const key = input.analytics ? (options.env ?? processEnv()).FARMJS_API_KEY?.trim() : undefined;
  const full = Boolean(
    signature && key && (await verifyFarmInfraManifestSignature(signature, key, request.url)),
  );
  const body = JSON.stringify(createFarmAppManifest(input, { full }));
  const etag = createFarmWeakETag(body);
  const headers = {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    // The full view is for Infra alone; shared caches keep the two views apart.
    "cache-control": full ? "private, no-store" : "public, max-age=0, must-revalidate",
    vary: FARM_INFRA_SIGNATURE_HEADER,
    etag,
    "x-content-type-options": "nosniff",
  };
  if (!full && matchesFarmIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(method === "HEAD" ? null : body, { status: 200, headers });
}
