import { createIntegrations } from '@farm.js/core/client';
import type { integrationLab } from './integration-lab.ts';

export const {
  api: integrationApi,
  apiClient: integrationApiClient,
} = createIntegrations<typeof integrationLab>({
  timeoutMs: 30_000,
  headers: async () => ({
    'Accept-Language':
      typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en',
  }),
});
