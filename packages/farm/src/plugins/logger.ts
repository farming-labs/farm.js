import type { FarmPlugin, FarmPluginContext } from '../plugin';
import type { FarmResponse } from '../types';
import type { FarmRequest } from '../types';

export function createLoggerPlugin({
  beforeRequest,
  afterResponse,
}: {
  beforeRequest?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
  afterResponse?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
} = {}): FarmPlugin {
  return {
    name: 'farm:logger',
    enforce: 'post',

    async beforeRequest(req, res, context) {
      if (beforeRequest) {
        await beforeRequest(req, res, context);
      }
    },

    async afterResponse(req, res, context) {
      if (afterResponse) {
        await afterResponse(req, res, context);
      }
    },
  };
}
