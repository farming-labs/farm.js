import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { HeaderConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { resolveFarmRequestURL } from "../server/request";
import { createConfigHeadersMatcher } from "./config-routes";

export const FARM_CONFIG_HEADERS_PLUGIN_NAME = "farm:headers";

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

function appendConfiguredSetCookieHeader(res: FarmResponse, value: string): void {
  const current = res.getHeader("Set-Cookie");
  if (current === undefined) {
    res.setHeader("Set-Cookie", value);
    return;
  }

  const values = (Array.isArray(current) ? current : [current]).map(String);
  if (!values.includes(value)) {
    res.setHeader("Set-Cookie", [...values, value]);
  }
}

function applyResponseHeaders(
  res: FarmResponse,
  matchedHeaders: readonly HeaderConfig["headers"][],
): void {
  for (const headers of matchedHeaders) {
    for (const header of headers) {
      const key = header.key.toLowerCase();
      if (key === "link") {
        appendConfiguredLinkHeader(res, header.value);
      } else if (key === "set-cookie") {
        appendConfiguredSetCookieHeader(res, header.value);
      } else {
        res.setHeader(header.key, header.value);
      }
    }
  }
}

function applyWriteHeadHeaders(res: FarmResponse, headers: unknown): void {
  if (Array.isArray(headers)) {
    let setCookieWritten = false;
    for (let index = 0; index + 1 < headers.length; index += 2) {
      const key = String(headers[index]);
      const value = headers[index + 1] as string | number | readonly string[];
      if (key.toLowerCase() === "set-cookie" && setCookieWritten) {
        const current = res.getHeader("Set-Cookie");
        const values = (Array.isArray(current) ? current : [current]).filter(
          (entry) => entry !== undefined,
        );
        res.setHeader("Set-Cookie", [...values, ...(Array.isArray(value) ? value : [value])]);
      } else {
        res.setHeader(key, value);
        if (key.toLowerCase() === "set-cookie") setCookieWritten = true;
      }
    }
    return;
  }

  if (!headers || typeof headers !== "object") return;
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) res.setHeader(key, value);
  }
}

/**
 * Give a Node response the matched config headers, as the dev server's headers plugin does: now,
 * and again when it writes its head, so a header the handler sets does not replace a configured
 * one. Used by pipelines that serve without this plugin (React Server Components).
 */
export function installConfigResponseHeaders(
  res: FarmResponse,
  matchedHeaders: readonly HeaderConfig["headers"][],
): void {
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
}

export function createHeadersPlugin(
  headers: HeaderConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
    i18n,
    basePath,
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
    /** Sources match the app-relative path, as in production. */
    basePath?: string;
  } = {},
): FarmPlugin {
  const matchHeaders = createConfigHeadersMatcher(headers, { i18n, basePath });

  return {
    name: FARM_CONFIG_HEADERS_PLUGIN_NAME,
    enforce: "pre",

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      installConfigResponseHeaders(res, matchHeaders(resolveFarmRequestURL(req)));
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
