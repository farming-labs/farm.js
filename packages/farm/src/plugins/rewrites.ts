import type { FarmPlugin, FarmPluginContext } from '../plugin';
import type { RewriteConfig } from '../config';
import type { FarmRequest, FarmResponse } from '../types';

export function createRewritesPlugin(
  rewrites: RewriteConfig[],
  {
    beforeRequest: overrideBeforeRequest,
    afterResponse: overrideAfterResponse,
  }: {
    beforeRequest?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
    afterResponse?: (req: FarmRequest, res: FarmResponse, context: FarmPluginContext) => void | Promise<void>;
  } = {}
): FarmPlugin {
  return {
    name: 'farm:rewrites',
    enforce: 'pre',

    async beforeRequest(req, res, context) {
      if (overrideBeforeRequest) {
        await overrideBeforeRequest(req, res, context);
      }
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      for (const rewrite of rewrites) {
        const sourceRegex = new RegExp(
          '^' + rewrite.source.replace(/\*/g, '(.*)').replace(/\//g, '\\/') + '$'
        );

        if (sourceRegex.test(pathname)) {
          const newPath = pathname.replace(sourceRegex, rewrite.destination);
          req.url = newPath + url.search;
          break;
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
