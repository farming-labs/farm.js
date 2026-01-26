import type { FarmPlugin, FarmPluginContext } from '../plugin';
import type { FarmRequest, FarmResponse } from '../types';
import * as zlib from 'zlib';

export function createCompressionPlugin({
  beforeRequest: overrideBeforeRequest,
  afterResponse: overrideAfterResponse,
}: {
  beforeRequest?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
  afterResponse?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
} = {}): FarmPlugin {
  return {
    name: 'farm:compression',
    enforce: 'post',

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
    },

    async afterResponse(req, res, context) {
      if (overrideAfterResponse) {
        await overrideAfterResponse(req, res, context);
      }
      if (!context.isProd) return;

      const acceptEncoding = req.headers['accept-encoding'] || '';

      if (acceptEncoding.includes('gzip')) {
        res.setHeader('Content-Encoding', 'gzip');
      } else if (acceptEncoding.includes('br')) {
        res.setHeader('Content-Encoding', 'br');
      }
    },
  };
}
