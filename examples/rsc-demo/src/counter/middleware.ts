/**
 * Counter page middleware
 * Demonstrates page-specific middleware and data sharing
 */
import { middleware } from '@farmjs/core/middleware';

export default middleware()
  // Add page-specific header
  .use(async (ctx, next) => {
    ctx.headers.set('X-Page', 'counter');
    
    // Share data with the page component
    ctx.data.set('pageLoadedAt', new Date().toISOString());
    ctx.data.set('visitorId', `visitor_${Math.random().toString(36).slice(2, 11)}`);
    ctx.data.set('featureFlags', {
      darkMode: true,
      newUI: false,
      analytics: true,
    });
    
    await next();
  });
