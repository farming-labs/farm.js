import { createEndpoint } from '@farmjs/core';
import { z } from 'zod';

// GET /api/hello - Simple hello world API
export const GET = createEndpoint('/api/hello', {
  method: 'GET',
  query: z.object({
    name: z.string().optional(),
  })
}, async (ctx) => {
  const name = ctx.query.name || 'World';
  console.log(`[API] GET /api/hello - name: ${name}`);
  
  return {
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
    method: 'GET',
  };
});

// POST /api/hello - Echo back with greeting
export const POST = createEndpoint('/api/hello', {
  method: 'POST',
  body: z.object({
    name: z.string(),
    email: z.string().email().optional(),
  })
}, async (ctx) => {
  const { name, email } = ctx.body;
  console.log(`[API] POST /api/hello - name: ${name}, email: ${email}`);
  
  return {
    message: `Hello, ${name}!`,
    email: email || 'not provided',
    timestamp: new Date().toISOString(),
    method: 'POST',
  };
});
