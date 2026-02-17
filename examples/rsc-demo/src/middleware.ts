/**
 * Root middleware - runs for all routes
 */
import { middleware } from '@farmjs/core/middleware';
import pc from 'picocolors';

// Helper for styled logging
const log = (tag: string, message: string) => {
  const prefix = pc.dim("[") + pc.bold(pc.blue("FARM")) + pc.dim("]");
  const tagStr = pc.dim("[") + pc.bold(pc.magenta(tag)) + pc.dim("]");
  console.log(`${prefix} ${tagStr} ${message}`);
};

export default middleware()
  // Add security headers
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-XSS-Protection', '1; mode=block');
    ctx.headers.set('X-Powered-By', 'Farm.js RSC');
    log("MW", `${pc.cyan(ctx.method)} ${pc.gray(ctx.pathname)}`);
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
