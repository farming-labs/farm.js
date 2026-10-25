/**
 * `/.well-known/api-catalog` (RFC 9727): a Linkset listing the APIs an app
 * publishes, so an agent that knows only the origin can find the OpenAPI
 * description and the MCP endpoint without guessing paths.
 */

import { resolveFarmAPIServerBasePath, resolveFarmAPIServerRoutePath } from "./api/server-path";
import type { ResolvedFarmAPIConfig } from "./api/config";
import { emitFarmAgentRead } from "./agent-identity";
import { applyFarmBasePath } from "./base-path";

export const FARM_API_CATALOG_PATH = "/.well-known/api-catalog";

const API_CATALOG_CONTENT_TYPE =
  'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

export interface FarmApiCatalogInput {
  /** The app's basePath; app routes such as the OpenAPI spec live beneath it. */
  basePath?: string;
  /** Public base of the HTTP API, a root-relative path or an absolute URL. */
  apiBaseURL: string;
  /** The OpenAPI spec and reference routes, when OpenAPI is enabled. */
  openapi?: { specRoute?: string | false; route?: string | false };
  /** The public path of the MCP endpoint, when MCP is enabled. */
  mcpPath?: string;
}

interface FarmLinkTarget {
  href: string;
  type?: string;
}

type FarmLinkContext = { anchor: string } & Record<string, string | FarmLinkTarget[]>;

export interface FarmApiCatalog {
  linkset: FarmLinkContext[];
}

/**
 * Reads the catalog's inputs from resolved config: the OpenAPI routes when
 * OpenAPI is on, and the public path of the top-level `mcp` endpoint.
 */
export function resolveFarmApiCatalogInput(config: {
  basePath?: string;
  api: ResolvedFarmAPIConfig;
  openapi?: {
    enabled?: boolean;
    specRoute?: string | false;
    route?: string | false;
    servers?: Array<{ url: string }>;
  };
  mcp?: false | { enabled?: boolean; path?: string };
}): FarmApiCatalogInput {
  const mcp = config.mcp && config.mcp.enabled !== false ? config.mcp : undefined;
  return {
    basePath: config.basePath,
    apiBaseURL: config.openapi?.servers?.[0]?.url ?? config.api.baseURL,
    openapi: config.openapi?.enabled
      ? { specRoute: config.openapi.specRoute, route: config.openapi.route }
      : undefined,
    mcpPath: mcp
      ? resolveFarmAPIServerRoutePath(
          mcp.path ?? "/api/mcp",
          resolveFarmAPIServerBasePath(config.api),
        )
      : undefined,
  };
}

/**
 * Builds the catalog. Links are root-relative, resolved against the catalog's
 * own URL, so the document never echoes a Host header back into a cacheable
 * response.
 */
export function createFarmApiCatalog(input: FarmApiCatalogInput): FarmApiCatalog {
  const appPath = (path: string) => applyFarmBasePath(path, input.basePath);
  const items: FarmLinkTarget[] = [];
  const contexts: FarmLinkContext[] = [];

  const specRoute = input.openapi?.specRoute;
  const reference = input.openapi?.route;
  if (specRoute || reference) {
    const api: FarmLinkContext = { anchor: input.apiBaseURL };
    if (specRoute) {
      api["service-desc"] = [
        { href: appPath(specRoute), type: "application/vnd.oai.openapi+json" },
      ];
    }
    if (reference) api["service-doc"] = [{ href: appPath(reference), type: "text/html" }];
    items.push({ href: input.apiBaseURL });
    contexts.push(api);
  }
  if (input.mcpPath) items.push({ href: input.mcpPath });

  return {
    linkset: [{ anchor: appPath(FARM_API_CATALOG_PATH), item: items }, ...contexts],
  };
}

/** Serves the catalog: the document on GET, and the `api-catalog` Link on GET and HEAD. */
export function createFarmApiCatalogResponse(
  method: string,
  input: FarmApiCatalogInput,
  /** The request being answered, so the read can be reported as agent traffic. */
  request?: Request,
): Response {
  const upperMethod = method.toUpperCase();
  if (upperMethod !== "GET" && upperMethod !== "HEAD") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (request) emitFarmAgentRead(request, "api-catalog", 200);
  const catalog = createFarmApiCatalog(input);
  return new Response(upperMethod === "HEAD" ? null : JSON.stringify(catalog), {
    status: 200,
    headers: {
      "Content-Type": API_CATALOG_CONTENT_TYPE,
      "Cache-Control": "public, max-age=0, must-revalidate",
      Link: `<${catalog.linkset[0]!.anchor}>; rel="api-catalog"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
