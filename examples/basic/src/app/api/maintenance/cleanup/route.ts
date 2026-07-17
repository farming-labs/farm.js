import { cronRoute } from '@farmjs/core/cron';

export const GET = cronRoute(async (request) => {
  return Response.json({
    ok: true,
    deleted: 0,
    cron: request.headers.get('x-farm-cron-name') || 'dailyCleanup',
  });
});
