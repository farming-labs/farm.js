/**
 * Dashboard-specific middleware
 * Demonstrates route-level middleware for authentication simulation
 */
import { middleware } from '@farmjs/core/middleware';

export default middleware()
  // Simulate authentication check
  .use(async (ctx, next) => {
    console.log('[Dashboard Middleware] Checking access...');
    
    const requestHeaders = ctx.request.headers as
      | Headers
      | Record<string, string | string[] | undefined>;
    const authHeader =
      requestHeaders instanceof Headers
        ? requestHeaders.get("authorization")
        : requestHeaders.authorization;
    
    if (authHeader) {
      console.log('[Dashboard Middleware] User is authenticated');
      ctx.headers.set('X-Auth-Status', 'authenticated');
    } else {
      console.log('[Dashboard Middleware] Demo mode - no auth required');
      ctx.headers.set('X-Auth-Status', 'demo-mode');
    }
    
    ctx.headers.set('X-Dashboard-Access', 'granted');
    
    await next();
  });
