/**
 * Root middleware - runs for all routes
 * Demonstrates the Farm.js middleware chain API
 */
import { middleware, type MiddlewareContext, type NextFunction } from '@farmjs/core/middleware';

export default middleware()
  // Log all requests with timing
  .use(async (_ctx: MiddlewareContext, next: NextFunction) => {
    const startTime = Date.now();
    
    await next();
    
    const _duration = Date.now() - startTime;
  })

  // Add security headers
  .use(async (ctx: MiddlewareContext, next: NextFunction) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-Farm-Demo', 'SSR-SSG-Demo');
    
    await next();
  })

  // Add custom header for API routes
  .when(
    (ctx: MiddlewareContext) => ctx.pathname.startsWith('/api'),
    async (ctx: MiddlewareContext, next: NextFunction) => {
      ctx.headers.set('X-API-Version', '1.0.0');
      await next();
    }
  );

export const config = {
  // Run for all routes except internal ones
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
