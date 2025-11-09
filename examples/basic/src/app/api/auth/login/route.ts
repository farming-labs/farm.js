import { createEndpoint } from 'farm';
import { z } from 'zod';

// POST /api/auth/login - Login endpoint
export const POST = createEndpoint('/api/auth/login', {
  method: 'POST',
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    hint: z.string().optional(),
  }),
}, async (ctx) => {
  const { email, password } = ctx.body;
  
  if (password === 'password123') {
    return {
      success: true,
      token: 'mock-jwt-token-' + Date.now(),
      user: {
        id: '1',
        email,
        name: 'Test User',
      },
    };
  }
  
  return {
    success: false,
    error: 'Invalid credentials',
  };
});

// GET /api/auth/login - Check auth status
export const GET = createEndpoint('/api/auth/login', {
  method: 'GET',
  query: z.object({
    token: z.string().optional(),
  }),
}, async (ctx) => {
  const { token } = ctx.query;
  
  return {
    authenticated: !!token,
    token: token || null,
  };
});

