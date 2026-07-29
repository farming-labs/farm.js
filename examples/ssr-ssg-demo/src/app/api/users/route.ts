import { createEndpoint } from '@farm.js/core';
import { z } from 'zod';

// Mock user database
const users = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com', role: 'admin' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com', role: 'user' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com', role: 'user' },
];

// GET /api/users - List all users or filter by role
export const GET = createEndpoint('/api/users', {
  method: 'GET',
  query: z.object({
    role: z.enum(['admin', 'user']).optional(),
    limit: z.coerce.number().min(1).max(100).optional(),
  })
}, async (ctx) => {
  console.log(`[API] GET /api/users - role: ${ctx.query.role}, limit: ${ctx.query.limit}`);
  
  let result = [...users];
  
  if (ctx.query.role) {
    result = result.filter(u => u.role === ctx.query.role);
  }
  
  if (ctx.query.limit) {
    result = result.slice(0, ctx.query.limit);
  }
  
  return {
    users: result,
    total: result.length,
    timestamp: new Date().toISOString(),
  };
});

// POST /api/users - Create a new user
export const POST = createEndpoint('/api/users', {
  method: 'POST',
  body: z.object({
    name: z.string().min(2),
    email: z.string().email(),
    role: z.enum(['admin', 'user']).default('user'),
  })
}, async (ctx) => {
  console.log(`[API] POST /api/users - creating user:`, ctx.body);
  
  const newUser = {
    id: users.length + 1,
    ...ctx.body,
  };
  
  users.push(newUser);
  
  return {
    success: true,
    user: newUser,
    message: `User ${ctx.body.name} created successfully`,
  };
});
