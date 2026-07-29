import {
  createClientOnlyFn,
  createIsomorphicFn,
  createServerOnlyFn,
} from '@farm.js/core/environment';
import { getEnv, getPublicEnv } from '@farm.js/core/env';

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
