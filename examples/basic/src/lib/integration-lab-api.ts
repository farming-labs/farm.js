import { createIntegrations } from '@farm.js/core/client';
import type { integrationLab } from './integration-lab.ts';

export const {
  api: integrationApi,
  apiClient: integrationApiClient,
} = createIntegrations<typeof integrationLab>({
  timeoutMs: 30_000,
  onRequest({ method, path }) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('integration-lab:request', { detail: { method, path } }));
    }
  },
  onResponse(_data, _error, { method, path, status }) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('integration-lab:response', { detail: { method, path, status } }));
    }
  },
  fetch: (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('x-integration-lab-transport', 'custom-fetch');
    return globalThis.fetch(url, { ...init, headers });
  },
  headers: async () => ({
    'Accept-Language':
      typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en',
  }),
});
