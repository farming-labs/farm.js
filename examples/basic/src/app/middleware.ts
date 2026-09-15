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
  // Guards both the rendered page and its raw markdown source. If the .md source
  // were served before middleware, this redirect would be bypassed and the raw
  // source leaked.
  .redirect('/protected-md', '/protected-md-login')
  .redirect('/protected-md.md', '/protected-md-login')
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
