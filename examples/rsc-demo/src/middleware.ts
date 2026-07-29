import { middleware } from '@farm.js/core/middleware';

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
  })
  .when((ctx) => ctx.pathname === '/api/request-alias', async (ctx, next) => {
    ctx.rewrite('/api/request-url');
    await next();
  });

export const config = {
  matcher: '/:path*',
  exclude: [
    '/_next/:path*',
    '/assets/:path*',
    '/static/:path*',
    '/favicon.ico',
  ],
};
