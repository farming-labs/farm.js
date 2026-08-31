import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { HeaderConfig } from "../config";
import type { FarmRequest, FarmResponse } from "../types";
import { compileConfigRoutePattern } from "./route-pattern";

export function createHeadersPlugin(
  headers: HeaderConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
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
      const pathname = url.pathname;

      for (const { config, pattern } of compiledHeaders) {
        if (pattern.regex.test(pathname)) {
          for (const header of config.headers) {
            res.setHeader(header.key, header.value);
          }
        }
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
