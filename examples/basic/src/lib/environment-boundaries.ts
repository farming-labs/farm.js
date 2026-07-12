import {
  createClientOnlyFn,
  createIsomorphicFn,
  createServerOnlyFn,
} from '@farmjs/core/environment';
import { getEnv, getPublicEnv } from '@farmjs/core/env';

export const readServerBoundary = createServerOnlyFn(() => {
  return `server:${getEnv('FARM_API_URL')}:FARM_SERVER_BOUNDARY_SENTINEL`;
});

export const readClientBoundary = createClientOnlyFn(() => {
  return `client:${getPublicEnv('PUBLIC_APP_NAME')}:${window.location.pathname}`;
});

export const readRuntimeBoundary = createIsomorphicFn({
  server: () => 'runtime:server',
  client: () => 'runtime:client',
});
