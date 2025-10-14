import type { FarmPlugin } from '../plugin';
import * as zlib from 'zlib';

export function createCompressionPlugin(): FarmPlugin {
  return {
    name: 'farm:compression',
    enforce: 'post',

    async afterResponse(req, res, context) {
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
