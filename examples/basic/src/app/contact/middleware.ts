/**
 * Farm Query Demo middleware - demonstrates page-specific middleware
 */
import { middleware } from 'farm/middleware';

export default middleware()
  .use(async (ctx, next) => {
    console.log('Contact page accessed');
    ctx.data.set('demoInfo', {
      message: 'This data wasnt set by middleware!',
      timestamp: new Date().toISOString(),
    });
    
    await next();
  })
  .use(async (ctx, next) => {
    const result = await ctx.data.get("demoInfo")
    console.log(result)
    await next();
  })
  .rateLimit({
    requests: 10,
    window: '1m',
    keyGenerator: (ctx) => {
      return ctx.request.socket.remoteAddress || 'unknown';
    },
  });

