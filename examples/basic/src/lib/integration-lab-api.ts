import { createIntegrations } from '@farm.js/core/client';
import type { integrationLab } from './integration-lab.ts';

export const {
  api: integrationApi,
  apiClient: integrationApiClient,
} = createIntegrations<typeof integrationLab>();
