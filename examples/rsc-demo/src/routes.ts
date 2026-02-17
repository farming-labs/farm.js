/**
 * Root routes file
 * 
 * Use this file to define API routes with explicit paths.
 * This is useful for routes that don't follow the file-based convention.
 */
import { createEndpoint } from '@farmjs/core';
import { z } from 'zod';

// Custom route with explicit path
export const healthCheck = createEndpoint('/api/health', {
  method: 'GET',
}, async () => {
  console.log("Health check endpoint called - HMR works!");
  return {
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
});

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
