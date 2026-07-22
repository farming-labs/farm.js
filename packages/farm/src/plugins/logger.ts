import type { FarmPlugin, FarmPluginContext } from "../plugin";
import type { FarmResponse } from "../types";
import type { FarmRequest } from "../types";

export function createLoggerPlugin({
  beforeRequest,
  afterResponse,
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
} = {}): FarmPlugin {
  const plugin: FarmPlugin = {
    name: "farm:logger",
    enforce: "post",
  };

  if (beforeRequest) {
    plugin.beforeRequest = async (req, res, context) => {
      await beforeRequest(req, res, context);
    };
  }
  if (afterResponse) {
    plugin.afterResponse = async (req, res, context) => {
      await afterResponse(req, res, context);
    };
  }

  return plugin;
}
