/**
 * Root routes file
 * 
 * Use this file to define API routes with explicit paths.
 * This is useful for routes that don't follow the file-based convention.
 */
import { createEndpoint } from '@farmjs/core/api';
import { headers } from '@farmjs/core/headers';
import { getCurrentRequest } from '@farmjs/core/request';
import { z } from 'zod';

// Custom route with explicit path
export const healthCheck = createEndpoint('/api/health', {
  method: 'GET',
}, async () => {
  console.log("Health check endpoint called - HMR works!");
  return {
    status: 'healthy',
    version: '1.0.0',
    requestContext: headers().get('x-rsc-request-context'),
    timestamp: new Date().toISOString(),
  };
});

export const requestUrl = createEndpoint('/api/request-url', {
  method: 'GET',
}, async () => ({ pathname: new URL(getCurrentRequest().url).pathname }));

// Another custom route with Zod validation
export const echo = createEndpoint('/api/echo', {
  method: 'POST',
  body: z.object({
    message: z.string().describe('The message to echo'),
  }),
}, async (ctx) => {
  console.log("Echo endpoint called with:", ctx.body.message);
  return {
    echo: ctx.body.message,
    timestamp: new Date().toISOString(),
  };
});
