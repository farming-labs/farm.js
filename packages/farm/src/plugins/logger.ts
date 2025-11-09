import type { FarmPlugin } from '../plugin';
import pc from 'picocolors';

export function createLoggerPlugin(): FarmPlugin {
  return {
    name: 'farm:logger',
    enforce: 'post',

    async beforeRequest(req, res, context) {
      if (!context.isDev) return;

      const startTime = Date.now();
      const method = req.method || 'GET';
      const url = req.url || '/';
      const host = req.headers.host || 'localhost:3000';

      (req as any).__farmStartTime = startTime;

      const log = [
        pc.dim('[') + pc.bold(pc.blue('FARM')) + pc.dim(']'),
        pc.dim('[') + pc.bold(pc.white(method.padEnd(3))) + pc.dim(']'),
        pc.gray(`http://${host}${url}`),
      ].join(' ');

      console.log(log);
    },

    async afterResponse(req, res, context) {
      if (!context.isDev) return;

      const startTime = (req as any).__farmStartTime || Date.now();
      const duration = Date.now() - startTime;
      const status = res.statusCode || 200;
      const url = req.url || '/';

      let statusColor = pc.green;
      if (status >= 500) statusColor = pc.red;
      else if (status >= 400) statusColor = pc.yellow;
      else if (status >= 300) statusColor = pc.cyan;

      const log = [
        pc.dim('[') + pc.bold(pc.blue('FARM')) + pc.dim(']'),
        status >= 400 ? pc.red('✗') : pc.green('✓'),
        pc.gray(url),
        pc.dim('-'),
        statusColor(status.toString()),
        pc.dim(`(${duration}ms)`),
      ].join(' ');

      console.log(log);
    },
  };
}
