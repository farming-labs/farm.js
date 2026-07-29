/**
 * About page middleware
 * Demonstrates page-specific middleware and data sharing
 */
import { middleware } from '@farm.js/core/middleware';

export default middleware()
  .use(async (ctx, next) => {
    // Add page-specific header
    ctx.headers.set('X-Page', 'about');
    
    // Share data with the page
    ctx.data.set('pageLoadedAt', new Date().toISOString());
    ctx.data.set('company', {
      name: 'Farm.js',
      founded: 2024,
      mission: 'Building the future of React Server Components',
    });
    ctx.data.set('team', [
      { name: 'Alice', role: 'Lead Developer' },
      { name: 'Bob', role: 'Designer' },
      { name: 'Charlie', role: 'DevOps' },
    ]);
    
    await next();
  });
