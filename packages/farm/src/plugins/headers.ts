import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { HeaderConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { compileConfigRoutePattern, resolveConfigRoutePathname } from "./route-pattern";

const FARM_CONFIG_HEADERS_FINALIZER = Symbol.for("farm.configHeadersFinalizer");

function appendConfiguredLinkHeader(res: FarmResponse, value: string): void {
  const current = res.getHeader("Link");
  if (current === undefined) {
    res.setHeader("Link", value);
    return;
  }

  const currentValue = Array.isArray(current) ? current.join(", ") : String(current);
  if (currentValue !== value && !currentValue.endsWith(`, ${value}`)) {
    res.setHeader("Link", `${currentValue}, ${value}`);
  }
}

function applyResponseHeaders(
  res: FarmResponse,
  matchedHeaders: readonly HeaderConfig["headers"][],
): void {
  for (const headers of matchedHeaders) {
    for (const header of headers) {
      if (header.key.toLowerCase() === "link") {
        appendConfiguredLinkHeader(res, header.value);
      } else {
        res.setHeader(header.key, header.value);
      }
    }
  }
}

function applyWriteHeadHeaders(res: FarmResponse, headers: unknown): void {
  if (Array.isArray(headers)) {
    for (let index = 0; index + 1 < headers.length; index += 2) {
      res.setHeader(String(headers[index]), headers[index + 1]);
    }
    return;
  }

  if (!headers || typeof headers !== "object") return;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) res.setHeader(key, value);
  }
}

export function createHeadersPlugin(
  headers: HeaderConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
    i18n,
  }: {
    beforeRequest?: (
      req: FarmRequest,
      res: FarmResponse,
      context: FarmPluginContext,
    ) => void | Promise<void>;
    afterResponse?: (
      req: FarmRequest,
      res: FarmResponse,
      context: FarmPluginContext,
    ) => void | Promise<void>;
    i18n?: ResolvedFarmI18nConfig;
  } = {},
): FarmPlugin {
  const compiledHeaders = headers.map((config) => ({
    config,
    pattern: compileConfigRoutePattern(config.source),
  }));

  return {
    name: "farm:headers",
    enforce: "pre",

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = new URL(req.url || "/", `http://${req.headers.host}`);
      const pathname = resolveConfigRoutePathname(url.pathname, i18n).pathname;
      const matchedHeaders = compiledHeaders
        .filter(({ pattern }) => pattern.regex.test(pathname))
        .map(({ config }) => config.headers);

      applyResponseHeaders(res, matchedHeaders);

      const responseWithFinalizer = res as FarmResponse & {
        [FARM_CONFIG_HEADERS_FINALIZER]?: boolean;
      };
      if (matchedHeaders.length === 0 || responseWithFinalizer[FARM_CONFIG_HEADERS_FINALIZER]) {
        return;
      }

      responseWithFinalizer[FARM_CONFIG_HEADERS_FINALIZER] = true;
      const writeHead = res.writeHead;
      res.writeHead = ((statusCode: number, ...args: unknown[]) => {
        const statusMessage = typeof args[0] === "string" ? (args.shift() as string) : undefined;
        applyWriteHeadHeaders(res, args[0]);
        applyResponseHeaders(res, matchedHeaders);
        return statusMessage === undefined
          ? (writeHead as any).call(res, statusCode)
          : (writeHead as any).call(res, statusCode, statusMessage);
      }) as FarmResponse["writeHead"];
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
