import { middleware } from '@farm.js/core/middleware';

export default middleware()
  .use(async (_ctx, next) => {
    await next();
  })
  .use(async (ctx, next) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-XSS-Protection', '1; mode=block');
    await next();
  })
  .redirect('/old-about', '/about')
  .redirect('/old-contact', '/contact', true)
  .when((ctx) => ctx.pathname.startsWith('/api'), async (ctx, next) => {
    ctx.headers.set('X-API-Version', '1.0.0');
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
