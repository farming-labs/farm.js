import type { FarmPlugin, FarmPluginContext } from '../plugin';
import type { FarmRequest, FarmResponse } from '../types';

export function createEnvPlugin(
  env: Record<string, string>,
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
  }: {
    beforeRequest?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
    afterResponse?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
  } = {}
): FarmPlugin {
  return {
    name: 'farm:env',

    config(config, context) {
      // Inject environment variables into the config
      return {
        ...config,
        env: {
          ...(config as any).env,
          ...env,
        },
      } as any;
    },
    configResolved(config, context) {
      for (const [key, value] of Object.entries(env)) {
        process.env[key] = value;
      }
    },

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
    },
  };
}
