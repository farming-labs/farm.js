/**
 * `/.well-known/farmjs.json`: one document describing a Farm app, so tools can discover it
 * instead of each rebuilding the picture: Farm's version, renderer and packages, the app's
 * MCP servers with every tool (however it was defined) and its schemas, their resources and
 * prompts, its WebMCP browser tools, its integrations, its agent surfaces and its plugins.
 * Never environment values, settings or secrets.
 *
 * Anyone may read it, in development and production alike, and everyone, Farm Infra
 * included, gets the same document (`agent.manifest: false` turns it off). It lists only what
 * an anonymous client could already find: an MCP server that requires `authorize` or sits
 * behind a guard shows its identity but not its tools, resources or prompts, and endpoint
 * tools never name their HTTP route. `agent.manifest` options hide sections (served as
 * `null`), package versions, schemas, or single servers and tools.
 */
import { FARM_DEFAULT_MCP_TOOLS } from "./agent-mcp";
import {
  resolveFarmAppManifestConfig,
  type ResolvedFarmAppManifestConfig,
} from "./app-manifest-config";
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

export type FarmAppManifestToolSource = "endpoint" | "defineTool" | "serverFunction";

export interface FarmAppManifestTool {
  name: string;
  title?: string;
  description?: string;
  /** How the app defined it: an API endpoint, `defineTool`, or a server function. */
  source: FarmAppManifestToolSource;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
  /**
   * JSON Schemas, when the server published them (`@farm.js/mcp` does) and
   * `agent.manifest.mcp.schemas` isn't `false`.
   */
  inputSchema?: Readonly<Record<string, unknown>>;
  outputSchema?: Readonly<Record<string, unknown>>;
}

type ServerDetails = NonNullable<FarmMCPCatalogDetails>;

export interface FarmAppManifestServer {
  name: string;
  version: string;
  path: string;
  /**
   * `"required"` when the server runs `authorize` or a guard covers its path: an anonymous
   * client lists nothing, so `tools`, `resources` and `prompts` are empty.
   */
  authorization: "none" | "required";
  tools: FarmAppManifestTool[];
  resources: NonNullable<ServerDetails["resources"]>;
  prompts: NonNullable<ServerDetails["prompts"]>;
}

/**
 * The manifest document. A section the app hid with `agent.manifest` is `null`, unlike an
 * empty list, which means there is nothing to show.
 */
export interface FarmAppManifest {
  schemaVersion: 1;
  /** `farm`, `renderer` and `build` are left out when `agent.manifest.app` hides them. */
  app: { farm?: string; renderer?: string; basePath: string; build?: string } | null;
  /**
   * Installed versions of the app's `@farm.js/*` and `@farming-labs/*` packages; `null`
   * versions with `agent.manifest.packages: "names"`.
   */
  packages: Record<string, string | null> | null;
  mcp: { servers: FarmAppManifestServer[] } | null;
  /** Browser tools from `@farm.js/webmcp`, read from the app's source. */
  webmcp: { enabled: boolean; tools: FarmAppManifestWebMCPTool[] } | null;
  /** The app's integrations: which slot each fills and which provider, never their config. */
  integrations: { key: string; category: string; type: string }[] | null;
  agent: { apiCatalog: string | null; llmsTxt: boolean; openapi: string | null } | null;
  plugins: string[] | null;
}

/** What the manifest reads from config; serializable, so a production build embeds it. */
export interface FarmAppManifestInput {
  renderer: string;
  basePath: string;
  /** The build's ID, or "development". */
  build: string;
  packages: Record<string, string>;
  webmcp: NonNullable<FarmAppManifest["webmcp"]>;
  integrations: NonNullable<FarmAppManifest["integrations"]>;
  agent: NonNullable<FarmAppManifest["agent"]>;
  plugins: string[];
  /** Resolved `agent.manifest` options; every section is shown without them. */
  sections?: ResolvedFarmAppManifestConfig;
  /**
   * The default read-only MCP server (`agent.mcp`) while the app would serve it. Set by the
   * server at runtime, not serialized: it answers only while no other MCP server is listed.
   */
  defaultMCP?: () => { name: string; version: string; path: string } | undefined;
  /**
   * Whether a guard written for a path (middleware, an integration's `protectedRoutes`)
   * covers an MCP server's endpoint. Set by the server at runtime: such a server is listed
   * as requiring authorization, without its tools, resources or prompts.
   */
  guardCoversPath?: (path: string) => boolean;
}

export function resolveFarmAppManifestInput(
  config: {
    basePath?: string;
    renderer?: { name: string };
    plugins?: readonly { name: string }[];
    agent?: {
      apiCatalog?: boolean;
      llmsTxt?: boolean | { enabled?: boolean };
      manifest?: unknown;
    };
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
  // User or resolved config; `false` serves nothing, so the server never asks for the input.
  const sections = resolveFarmAppManifestConfig(config.agent?.manifest);
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
    ...(sections ? { sections } : {}),
  };
}

const SOURCES = {
  endpoint: "endpoint",
  standalone: "defineTool",
  serverFunction: "serverFunction",
} as const;

const DEFAULT_SECTIONS = resolveFarmAppManifestConfig(undefined) as ResolvedFarmAppManifestConfig;

/** The manifest now: the static input plus the MCP tools the running servers published. */
export function createFarmAppManifest(input: FarmAppManifestInput): FarmAppManifest {
  const sections = input.sections ?? DEFAULT_SECTIONS;
  const { app, mcp, webmcp } = sections;
  return {
    schemaVersion: 1,
    app: app
      ? {
          ...(app.version ? { farm: FARM_VERSION } : {}),
          ...(app.renderer ? { renderer: input.renderer } : {}),
          basePath: input.basePath,
          ...(app.build ? { build: input.build } : {}),
        }
      : null,
    packages:
      sections.packages === "names"
        ? Object.fromEntries(Object.keys(input.packages).map((name) => [name, null]))
        : sections.packages
          ? input.packages
          : null,
    mcp: mcp ? { servers: listServers(input, mcp) } : null,
    webmcp: webmcp
      ? {
          enabled: input.webmcp.enabled,
          tools: input.webmcp.tools.filter((tool) => !webmcp.hide.includes(tool.name)),
        }
      : null,
    integrations: sections.integrations ? input.integrations : null,
    agent: sections.agent ? input.agent : null,
    plugins: sections.plugins ? input.plugins : null,
  };
}

type MCPSection = Exclude<ResolvedFarmAppManifestConfig["mcp"], false>;

function listServers(input: FarmAppManifestInput, mcp: MCPSection): FarmAppManifestServer[] {
  const servers = _listFarmMCPCatalogs().map(({ server, tools, details }) => {
    // A server that didn't say it's public (an older @farm.js/mcp) counts as protected,
    // as does one behind a guard written for its path: anonymous clients cannot list it.
    const open = details?.public === true && !input.guardCoversPath?.(server.path);
    return {
      name: server.name,
      version: server.version,
      path: server.path,
      authorization: open ? "none" : "required",
      resources: open ? [...(details?.resources ?? [])] : [],
      prompts: open ? [...(details?.prompts ?? [])] : [],
      tools: (open ? tools : []).map((tool): FarmAppManifestTool => {
        const schemas = details?.schemas?.[tool.name];
        const hints = Object.fromEntries(
          (["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const)
            .filter((hint) => typeof tool[hint] === "boolean")
            .map((hint) => [hint, tool[hint]]),
        );
        // MCP clients never see the route behind an endpoint tool, so neither does this.
        return {
          name: tool.name,
          ...(tool.title ? { title: tool.title } : {}),
          ...(tool.description ? { description: tool.description } : {}),
          source: SOURCES[tool.kind],
          ...hints,
          ...(schemas ? { inputSchema: schemas.input } : {}),
          ...(schemas?.output ? { outputSchema: schemas.output } : {}),
        };
      }),
    } satisfies FarmAppManifestServer;
  });
  return [...servers, ...listDefaultServer(input)]
    .filter((server) => !mcp.hide.includes(server.name))
    .map((server) => ({
      ...server,
      tools: server.tools
        .filter((tool) => !mcp.hide.includes(`${server.name}/${tool.name}`))
        .map((tool) => (mcp.schemas ? tool : withoutSchemas(tool))),
    }));
}

function withoutSchemas({
  inputSchema: _input,
  outputSchema: _output,
  ...tool
}: FarmAppManifestTool): FarmAppManifestTool {
  return tool;
}

/** The default server lists its tools to anyone: it answers anonymous clients. */
function listDefaultServer(input: FarmAppManifestInput): FarmAppManifestServer[] {
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

/** Public, read-only metadata, like the AI catalog: any origin may read it. */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "If-None-Match",
  "access-control-expose-headers": "ETag",
};

/** Answers `/.well-known/farmjs.json`: the same public document for every request. */
export async function createFarmAppManifestResponse(
  request: Request,
  input: FarmAppManifestInput,
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { ...CORS_HEADERS, allow: "GET, HEAD, OPTIONS", "content-type": "text/plain" },
    });
  }
  const body = JSON.stringify(createFarmAppManifest(input));
  const etag = createFarmWeakETag(body);
  const headers = {
    ...CORS_HEADERS,
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=0, must-revalidate",
    etag,
    "x-content-type-options": "nosniff",
  };
  if (matchesFarmIfNoneMatch(request.headers.get("if-none-match"), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(method === "HEAD" ? null : body, { status: 200, headers });
}
