/**
 * API middleware - runs for all /api/* routes
 */
import { middleware } from 'farm/middleware';

export default middleware()
  // CORS headers for API routes
  .use(async (ctx, next) => {
    ctx.headers.set('Access-Control-Allow-Origin', '*');
    ctx.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    ctx.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle OPTIONS preflight
    if (ctx.method === 'OPTIONS') {
      ctx.text('OK', 200);
      return;
    }
    
    await next();
  })

  // Mock authentication for API routes
  .use(async (ctx, next) => {
    const authHeader = ctx.request.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      
      // Mock token validation
      if (token === 'demo-token-123') {
        ctx.data.set('user', {
          id: 1,
          name: 'Demo User',
          email: 'demo@example.com',
        });
      } else {
        ctx.json({ error: 'Invalid token' }, 401);
        return;
      }
    }
    
    // Continue even if no auth (some routes might be public)
    await next();
  })

  // Rate limiting for API routes
  .rateLimit({
    requests: 100,
    window: '1m',
    keyGenerator: (ctx) => {
      const user = ctx.data.get('user');
      return user ? `user:${user.id}` : `ip:${ctx.request.socket.remoteAddress}`;
    },
    onLimit: (ctx) => {
      ctx.json(
        {
          error: 'Rate limit exceeded',
          message: 'Too many requests. Please try again later.',
        },
        429
      );
    },
  })

  // Log API requests
  .use(async (ctx, next) => {
    const user = ctx.data.get('user');
    console.log(`API Request: ${ctx.method} ${ctx.pathname} ${user ? `(User: ${user.name})` : '(Anonymous)'}`);
    
    await next();
  });

