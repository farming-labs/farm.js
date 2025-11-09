import type { FarmPlugin } from '../plugin';
import type { HeaderConfig } from '../config';

export function createHeadersPlugin(headers: HeaderConfig[]): FarmPlugin {
  return {
    name: 'farm:headers',
    enforce: 'pre',

    async beforeRequest(req, res, context) {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      for (const headerConfig of headers) {
        const sourceRegex = new RegExp(
          '^' + headerConfig.source.replace(/\*/g, '(.*)').replace(/\//g, '\\/') + '$'
        );

        if (sourceRegex.test(pathname)) {
          for (const header of headerConfig.headers) {
            res.setHeader(header.key, header.value);
          }
        }
      }
    },
  };
}
