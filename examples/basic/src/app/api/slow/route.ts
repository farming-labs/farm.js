import { createEndpoint } from '@farmjs/core';

/**
 * Slow API for loading-boundary demo. Waits 2s then returns.
 * Use so a route can show loading.tsx while "fetching" this.
 */
export const GET = createEndpoint('/api/slow', { method: 'GET' }, async () => {
  await new Promise((r) => setTimeout(r, 2000));
  return {
    message: 'Data loaded after delay',
    at: new Date().toISOString(),
  };
});
