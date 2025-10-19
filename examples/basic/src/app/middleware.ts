/**
 * Root middleware - runs for all routes
 */
import { middleware } from 'farm/middleware';

export default middleware()
  // Log all requests
  .use(async (ctx, next) => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] ${ctx.method} ${ctx.pathname}`);
    
    // Store start time for duration tracking
    ctx.data.set('startTime', startTime);
    
    await next();
    
    const duration = Date.now() - startTime;
    console.log(`[${new Date().toISOString()}] Completed ${ctx.pathname} in ${duration}ms`);
  })

  // Add security headers
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-XSS-Protection', '1; mode=block');
    
    await next();
  })

  // Demo: Redirect old paths
  .redirect('/old-about', '/about')
  .redirect('/old-contact', '/contact', true) // permanent redirect

  // Demo: Add custom header for API routes
  .when('/api/*', async (ctx, next) => {
    ctx.headers.set('X-API-Version', '1.0.0');
    await next();
  });

export const config = {
  // Run for all routes except internal ones
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};

