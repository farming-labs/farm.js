import { middleware } from '@farmjs/core/middleware';

export default middleware()
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-XSS-Protection', '1; mode=block');
    ctx.headers.set('X-Powered-By', 'Farm.js RSC');
    await next();
  })
  .when((ctx) => ctx.pathname.startsWith('/api'), async (ctx, next) => {
    ctx.headers.set('X-API-Version', '1.0.0');
    await next();
  });

export const config = {
  matcher: ['/((?!_next|static|favicon.ico).*)'],
};
