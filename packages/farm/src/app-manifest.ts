/**
 * `/.well-known/farmjs.json`: one document describing a Farm app, so tools can discover it
 * instead of each rebuilding the picture: Farm's version, renderer and packages, the app's
 * MCP servers with every tool (however it was defined) and its schemas, their resources and
 * prompts, its WebMCP browser tools, its integrations, its agent surfaces and its plugins.
 * Never environment values, settings or secrets.
 *
 * Development serves it to anyone on the dev server. Production answers only a request
 * signed for the app's Farm Infra key, so the public never reads the app's internals; any
 * other request gets a 404. Kept free of Node built-ins: Web Crypto only.
 */
import type { FarmAppManifestWebMCPTool } from "./app-manifest-webmcp";
import { _listFarmMCPCatalogs, type FarmMCPCatalogDetails } from "./mcp-catalog";
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
/** Farm Infra signs manifest requests in this header: `t=<unix seconds>, v1=<hex>`. */
export const FARM_INFRA_SIGNATURE_HEADER = "farmjs-infra-signature";

const SIGNED_PURPOSE = "farmjs-manifest-v1";
const SIGNATURE_WINDOW_SECONDS = 300;

export type FarmAppManifestToolSource = "endpoint" | "defineTool" | "serverFunction";

export interface FarmAppManifestTool {
  name: string;
  title?: string;
  description?: string;
  /** How the app defined it: an API endpoint, `defineTool`, or a server function. */
  source: FarmAppManifestToolSource;
  /** The endpoint's method and route, for `source: "endpoint"`. */
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
  /** `analytics: false` keeps the production manifest off: the app talks to no Farm Infra. */
  analytics: boolean;
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

/** The manifest now: the static input plus the MCP tools the running servers published. */
export function createFarmAppManifest(input: FarmAppManifestInput): FarmAppManifest {
  return {
    schemaVersion: 1,
    app: {
      farm: FARM_VERSION,
      renderer: input.renderer,
      basePath: input.basePath,
      build: input.build,
    },
    packages: input.packages,
    mcp: {
      servers: _listFarmMCPCatalogs().map(({ server, tools, details }) => ({
        name: server.name,
        version: server.version,
        path: server.path,
        resources: [...(details?.resources ?? [])],
        prompts: [...(details?.prompts ?? [])],
        tools: tools.map((tool) => {
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
            ...(tool.kind === "endpoint" ? { method: tool.method, path: tool.path } : {}),
            ...hints,
            ...(schemas ? { inputSchema: schemas.input } : {}),
            ...(schemas?.output ? { outputSchema: schemas.output } : {}),
          };
        }),
      })),
    },
    webmcp: input.webmcp,
    integrations: input.integrations,
    agent: input.agent,
    plugins: input.plugins,
  };
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

/**
 * Signs a manifest request the way Farm Infra does. Infra stores only the SHA-256 of a key,
 * so the HMAC secret is that hash: the app derives it from its own key, Infra already has it.
 */
export async function signFarmInfraManifestRequest(keyHash: string, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return `t=${timestamp}, v1=${await hmacHex(keyHash, `${SIGNED_PURPOSE}\n${timestamp}`)}`;
}

/** True when the header carries a fresh signature for this key. Any `v1` may match. */
export async function verifyFarmInfraManifestSignature(
  header: string | null,
  key: string,
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
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3))
    .filter((value) => /^[0-9a-f]{64}$/.test(value));
  if (!signatures.length || signatures.length > 8) return false;
  const expected = await hmacHex(await sha256Hex(key), `${SIGNED_PURPOSE}\n${timestamp}`);
  return signatures.some((signature) => sameHex(signature, expected));
}

type Env = Record<string, string | undefined>;

function processEnv(): Env {
  return (globalThis as { process?: { env?: Env } }).process?.env ?? {};
}

/**
 * Answers `/.well-known/farmjs.json`, or `null` to let the request go on as if Farm served nothing
 * there: methods other than GET and HEAD, and production apps not linked to Farm Infra.
 */
export async function createFarmAppManifestResponse(
  request: Request,
  input: FarmAppManifestInput,
  options: { development: boolean; env?: Env },
): Promise<Response | null> {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (!options.development) {
    const key = (options.env ?? processEnv()).FARMJS_API_KEY?.trim();
    if (!input.analytics || !key) return null;
    const signed = await verifyFarmInfraManifestSignature(
      request.headers.get(FARM_INFRA_SIGNATURE_HEADER),
      key,
    );
    if (!signed)
      return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }
  const body = JSON.stringify(createFarmAppManifest(input));
  return new Response(request.method === "HEAD" ? null : body, {
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}
