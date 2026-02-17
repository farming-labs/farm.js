/**
 * Root middleware - runs for all routes
 * Demonstrates the Farm.js middleware chain API
 */
import { middleware } from '@farmjs/core/middleware';

export default middleware()
  // Log all requests with timing
  .use(async (ctx, next) => {
    const startTime = Date.now();
    console.log(`[Middleware] ${ctx.method} ${ctx.pathname}`);
    
    await next();
    
    const duration = Date.now() - startTime;
    console.log(`[Middleware] Completed ${ctx.pathname} in ${duration}ms`);
  })

  // Add security headers
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-Farm-Demo', 'SSR-SSG-Demo');
    
    await next();
  })

  // Add custom header for API routes
  .when((ctx) => ctx.pathname.startsWith('/api'), async (ctx, next) => {
    ctx.headers.set('X-API-Version', '1.0.0');
    await next();
  });

export const config = {
  // Run for all routes except internal ones
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
