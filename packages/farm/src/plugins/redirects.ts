import type { FarmPlugin } from '../plugin';
import type { RedirectConfig } from '../config';

export function createRedirectsPlugin(redirects: RedirectConfig[]): FarmPlugin {
  return {
    name: 'farm:redirects',
    enforce: 'pre',
    async beforeRequest(req, res, context) {
      const url = new URL(req.url || '/', `http://${req.headers.host}`);
      const pathname = url.pathname;

      for (const redirect of redirects) {
        // Convert Next.js-style patterns to regex
        // :param -> ([^/]+)
        // :param* -> (.*)
        // * -> (.*)
        const pattern = redirect.source
          .replace(/:\w+\*/g, '(.*)') // :param* -> (.*)
          .replace(/:\w+/g, '([^/]+)') // :param -> ([^/]+)
          .replace(/\*/g, '(.*)') // * -> (.*)
          .replace(/\//g, '\\/'); // escape slashes

        const sourceRegex = new RegExp(`^${pattern}$`);

        if (sourceRegex.test(pathname)) {
          // Replace captured groups in destination
          let destination = redirect.destination;
          const matches = pathname.match(sourceRegex);

          if (matches) {
            // Replace :param or :param* with captured values
            const params = redirect.source.match(/:\w+\*?/g) || [];
            params.forEach((param, index) => {
              destination = destination.replace(param, matches[index + 1] || '');
            });

            // Also replace plain * with captured values
            const stars = redirect.source.match(/(?<!:)\*/g) || [];
            stars.forEach((_, index) => {
              destination = destination.replace('*', matches[params.length + index + 1] || '');
            });
          }

          const statusCode = redirect.statusCode || (redirect.permanent ? 308 : 307);

          res.writeHead(statusCode, {
            Location: destination,
          });
          res.end();
          return;
        }
      }
    },
  };
}
