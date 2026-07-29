import { middleware, type MiddlewareContext, type NextFunction } from '@farm.js/core/middleware';

export default middleware()
  .use(async (_ctx: MiddlewareContext, next: NextFunction) => {
    await next();
  })
  .use(async (ctx: MiddlewareContext, next: NextFunction) => {
    ctx.headers.set('X-Frame-Options', 'DENY');
    ctx.headers.set('X-Content-Type-Options', 'nosniff');
    ctx.headers.set('X-Farm-Demo', 'SSR-SSG-Demo');
    await next();
  })
  .when(
    (ctx: MiddlewareContext) => ctx.pathname.startsWith('/api'),
    async (ctx: MiddlewareContext, next: NextFunction) => {
      ctx.headers.set('X-API-Version', '1.0.0');
      await next();
    }
  );

export const config = {
  matcher: '/:path*',
  exclude: [
    '/_next/:path*',
    '/assets/:path*',
    '/static/:path*',
    '/favicon.ico',
  ],
};
