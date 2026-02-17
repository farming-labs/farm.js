import { createEndpoint } from '@farmjs/core';
import { z } from 'zod';

// Mock database
const users = [
  { id: '1', name: 'Alice', email: 'alice@example.com' },
  { id: '2', name: 'Bob', email: 'bob@example.com' },
  { id: '3', name: 'Charlie', email: 'charlie@example.com' },
];

// GET /api/users - List all users
export const GET = createEndpoint('/api/users', {
  method: 'GET',
  query: z.object({
    limit: z.string().optional().describe('Maximum number of users to return'),
    offset: z.string().optional().describe('Number of users to skip'),
  }),
}, async (ctx) => {
  const limit = ctx.query.limit ? Number.parseInt(ctx.query.limit) : 10;
  const offset = ctx.query.offset ? Number.parseInt(ctx.query.offset) : 0;
  
  const paginatedUsers = users.slice(offset, offset + limit);
  
  return {
    users: paginatedUsers,
    total: users.length,
    limit,
    offset,
  };
});

// POST /api/users - Create a new user
export const POST = createEndpoint('/api/users', {
  method: 'POST',
  body: z.object({
    name: z.string().describe('The name of the user'),
    email: z.string().email().describe('The email of the user'),
  }),
}, async (ctx) => {
  const newUser = {
    id: String(users.length + 1),
    ...ctx.body,
  };
  
  users.push(newUser);
  
  return {
    success: true,
    user: newUser,
  };
});
