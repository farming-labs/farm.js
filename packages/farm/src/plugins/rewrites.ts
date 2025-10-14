import type { FarmPlugin } from '../plugin';
import type { RewriteConfig } from '../config';

export function createRewritesPlugin(rewrites: RewriteConfig[]): FarmPlugin {
  return {
    name: 'farm:rewrites',
    enforce: 'pre',

    async beforeRequest(req, res, context) {
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
  };
}
