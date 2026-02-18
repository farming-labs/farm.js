/**
 * Root middleware - runs for all routes
 * Logging is handled by the framework - no need for manual logging here
 */
import { middleware } from '@farmjs/core/middleware';

export default middleware()
  // Add security headers
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-XSS-Protection', '1; mode=block');
    ctx.headers.set('X-Powered-By', 'Farm.js RSC');
    await next();
  })

  // Add API version header for API routes
  .when((ctx) => ctx.pathname.startsWith('/api'), async (ctx, next) => {
    ctx.headers.set('X-API-Version', '1.0.0');
    await next();
  });

export const config = {
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
