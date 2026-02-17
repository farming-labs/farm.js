import { createEndpoint } from '@farmjs/core';
import { z } from 'zod';

// GET /api/hello - path is auto-inferred from file location
export const GET = createEndpoint({
  method: 'GET',
  query: z.object({ 
    name: z.string().optional().describe('The name of the person to greet'),
    greeting: z.string().optional().describe('Custom greeting to use'),
  }),
}, async (ctx) => {
  const name = ctx.query?.name || 'World';
  const greeting = ctx.query?.greeting || 'Hello';
  console.log("GET /api/hello name:", name, "greeting:", greeting);
  return {
    message: `${greeting}, ${name}!`,
    timestamp: new Date().toISOString(),
    framework: 'Farm.js RSC',
  };
});

// POST /api/hello - path is auto-inferred from file location
export const POST = createEndpoint({
  method: 'POST',
  body: z.object({
    name: z.string().optional().describe('The name of the person to greet'),
  }),
}, async (ctx) => {
  const name = ctx.body.name || 'World';
  return {
    message: `Hello, ${name}!`,
    timestamp: new Date().toISOString(),
  };
});
