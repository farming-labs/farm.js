/**
 * Type-safe API client for the app
 * All the proxy magic is handled by Farm.js!
 * 
 * Auto-generated types from API routes in src/app/api
 * Run `pnpm generate-api-types` to update
 */

import { createAPIClient } from '@farm.js/core/client';
import type { APIRouter } from './api.generated';

export const api = createAPIClient<APIRouter>();

