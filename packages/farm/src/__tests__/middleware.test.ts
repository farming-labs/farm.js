/**
 * Tests for Farm.js Middleware System
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { middleware } from '../middleware/chain';
import { createContext } from '../middleware/context';
import type { MiddlewareContext } from '../middleware/types';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

// Helper to create mock request/response
function createMockRequest(url: string, method: string = 'GET'): IncomingMessage {
  const socket = new Socket();
  const req = new IncomingMessage(socket);
  req.url = url;
  req.method = method;
  req.headers = {
    host: 'localhost:3000',
  };
  return req;
}

function createMockResponse(): ServerResponse {
  const socket = new Socket();
  const res = new ServerResponse(createMockRequest('/'));
  
  // Mock writeHead and end
  res.writeHead = vi.fn().mockReturnValue(res);
  res.end = vi.fn();
  res.setHeader = vi.fn();
  
  return res;
}

describe('Middleware Chain', () => {
  it('should create a middleware chain', () => {
    const chain = middleware();
    expect(chain).toBeDefined();
    expect(typeof chain.use).toBe('function');
  });

  it('should execute middleware in order', async () => {
    const order: number[] = [];
    
    const chain = middleware()
      .use(async (ctx, next) => {
        order.push(1);
        await next();
        order.push(4);
      })
      .use(async (ctx, next) => {
        order.push(2);
        await next();
        order.push(3);
      });

    const { handlers } = chain.build();
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    // Execute handlers
    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(order).toEqual([1, 2, 3, 4]);
  });

  it('should stop execution on redirect', async () => {
    const order: number[] = [];
    
    const chain = middleware()
      .use(async (ctx, next) => {
        order.push(1);
        ctx.redirect('/login');
      })
      .use(async (ctx, next) => {
        order.push(2); // Should not execute
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length && !ctx._handled) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(order).toEqual([1]); // Only first middleware runs
    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(307, expect.any(Object));
  });

  it('should support conditional middleware with .when()', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when('/admin/*', async (ctx, next) => {
        executed.push('admin');
        await next();
      })
      .when('/user/*', async (ctx, next) => {
        executed.push('user');
        await next();
      })
      .use(async (ctx, next) => {
        executed.push('always');
        await next();
      });

    const { handlers } = chain.build();

    // Test admin path
    {
      executed.length = 0;
      const req = createMockRequest('/admin/dashboard');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(['admin', 'always']);
    }

    // Test user path
    {
      executed.length = 0;
      const req = createMockRequest('/user/profile');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(['user', 'always']);
    }

    // Test other path
    {
      executed.length = 0;
      const req = createMockRequest('/other');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toEqual(['always']);
    }
  });

  it('should support redirect helper', async () => {
    const chain = middleware()
      .redirect('/old-path', '/new-path', true);

    const { handlers } = chain.build();
    const req = createMockRequest('/old-path');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length && !ctx._handled) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(308, expect.any(Object));
  });

  it('should support rewrite helper', async () => {
    const chain = middleware()
      .rewrite('/old-url', '/new-url');

    const { handlers } = chain.build();
    const req = createMockRequest('/old-url');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    let index = 0;
    const executeNext = async (): Promise<void> => {
      if (index < handlers.length) {
        const handler = handlers[index++];
        await handler(ctx, executeNext);
      }
    };

    await executeNext();

    expect(ctx._rewriteUrl).toBe('/new-url');
    expect(ctx.pathname).toBe('/new-url');
  });

  it('should support rate limiting', async () => {
    const chain = middleware()
      .rateLimit({
        requests: 2,
        window: '1s',
        keyGenerator: (ctx) => 'test-key',
      });

    const { handlers } = chain.build();

    // First request - should pass
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._handled).toBe(false);
    }

    // Second request - should pass
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._handled).toBe(false);
    }

    // Third request - should be rate limited
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(ctx._handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(429, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
    }
  });
});

describe('Middleware Context', () => {
  it('should create context from request/response', () => {
    const req = createMockRequest('/test?foo=bar');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.pathname).toBe('/test');
    expect(ctx.searchParams.get('foo')).toBe('bar');
    expect(ctx.method).toBe('GET');
  });

  it('should handle data storage', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.data.set('user', { id: 1, name: 'John' });
    expect(ctx.data.get('user')).toEqual({ id: 1, name: 'John' });
  });

  it('should handle redirects', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.redirect('/login', 302);

    expect(ctx._handled).toBe(true);
    expect(ctx._redirectUrl).toBe('/login');
    expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({
      Location: '/login',
    }));
  });

  it('should handle rewrites', () => {
    const req = createMockRequest('/old');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite('/new');

    expect(ctx._rewriteUrl).toBe('/new');
    expect(ctx.pathname).toBe('/new');
    expect(req.url).toBe('/new');
  });

  it('should handle JSON responses', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.json({ message: 'Hello' }, 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'application/json',
    }));
  });

  it('should handle cookies', () => {
    const req = createMockRequest('/test');
    req.headers.cookie = 'session=abc123; user=john';
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.cookies.get('session')).toBe('abc123');
    expect(ctx.cookies.get('user')).toBe('john');

    ctx.cookies.set('new-cookie', 'value123', { maxAge: 3600 });
    expect(res.setHeader).toHaveBeenCalled();
  });
});

describe('Pattern Matching', () => {
  it('should match glob patterns', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when('/api/*', async (ctx, next) => {
        executed.push('api');
        await next();
      })
      .when('/admin/**/*', async (ctx, next) => {
        executed.push('admin-deep');
        await next();
      });

    const { handlers } = chain.build();

    // Test /api/users
    {
      executed.length = 0;
      const req = createMockRequest('/api/users');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toContain('api');
    }

    // Test /admin/users/settings
    {
      executed.length = 0;
      const req = createMockRequest('/admin/users/settings');
      const res = createMockResponse();
      const ctx = createContext(req, res);

      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };

      await executeNext();
      expect(executed).toContain('admin-deep');
    }
  });
});

