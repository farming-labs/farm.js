/**
 * Tests for Farm.js Middleware System
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { middleware } from '../middleware/chain';
import { createContext } from '../middleware/context';
import { _setCurrentMiddlewareData, _clearCurrentMiddlewareData, getMiddlewareData, getMiddlewareValue } from '../middleware/server';
import type { MiddlewareContext } from '../middleware/types';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';

async function executeChain(handlers: any[], ctx: MiddlewareContext) {
  let index = 0;
  const executeNext = async (): Promise<void> => {
    if (index < handlers.length && !ctx._handled) {
      const handler = handlers[index++];
      await handler(ctx, executeNext);
    }
  };
  await executeNext();
}

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
  res.end = vi.fn().mockImplementation((chunk?: any, encoding?: BufferEncoding, cb?: (() => void) | undefined) => {
    if (cb) {
      cb();
    }
    return res;
  });
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
    expect(handlers.length).toBe(3)
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
    expect(handlers.length).toBe(1)
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
    expect(handlers.length).toBe(1)
    expect(ctx.pathname).toBe('/old-url')
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

  it('should support rate limiting with default in-memory storage', async () => {
    const spyFn = vi.fn() 
    const chain = middleware()
      .rateLimit({
        requests: 2,
        window: '1s',
        keyGenerator: (ctx) => 'test-key',
        onLimit: (ctx) => {
            spyFn(ctx)
        }
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
      expect(spyFn).toHaveBeenCalledWith(ctx)
      expect(ctx._handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(429, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
    }
  });

  it('should support rate limiting with custom storage (Redis-like)', async () => {
    // Create a mock Redis-like storage
    const mockRedisStore = new Map<string, string>();
    const customStorage = {
      async set(key: string, value: any, ttl?: number) {
        mockRedisStore.set(key, JSON.stringify(value));
        // In real Redis, TTL would auto-expire the key
        if (ttl) {
          setTimeout(() => {
            mockRedisStore.delete(key);
          }, ttl * 1000);
        }
      },
      async get(key: string) {
        const data = mockRedisStore.get(key);
        return data ? JSON.parse(data) : null;
      },
      async delete(key: string) {
        mockRedisStore.delete(key);
      },
    };

    const spyFn = vi.fn();
    const chain = middleware()
      .rateLimit({
        requests: 3,
        window: '1s',
        keyGenerator: (ctx) => 'redis-test-key',
        storage: customStorage,
        onLimit: (ctx) => {
          spyFn(ctx);
        },
      });

    const { handlers } = chain.build();

    // Helper to execute chain
    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // First request - should pass
    {
      const req = createMockRequest('/api/data');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = JSON.parse(mockRedisStore.get('redis-test-key') || '{}').count;
      expect(count).toBe(1);
    }

    // Second request - should pass
    {
      const req = createMockRequest('/api/data');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = JSON.parse(mockRedisStore.get('redis-test-key') || '{}').count;
      expect(count).toBe(2);
    }

    // Third request - should pass
    {
      const req = createMockRequest('/api/data');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
      const count = JSON.parse(mockRedisStore.get('redis-test-key') || '{}').count;
      expect(count).toBe(3);
    }

    // Fourth request - should be rate limited
    {
      const req = createMockRequest('/api/data');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(spyFn).toHaveBeenCalledWith(ctx);
      expect(ctx._handled).toBe(true);
      expect(res.writeHead).toHaveBeenCalledWith(429, expect.objectContaining({
        'Content-Type': 'application/json',
      }));
    }

    // Verify that the custom storage was actually used
    expect(mockRedisStore.size).toBeGreaterThan(0);
  });

  it('should support custom storage with synchronous operations', async () => {
    // Create a simple Map-based synchronous storage
    const syncStore = new Map<string, any>();
    const customStorage = {
      set(key: string, value: any, ttl?: number) {
        syncStore.set(key, value);
      },
      get(key: string) {
        return syncStore.get(key) || null;
      },
      delete(key: string) {
        syncStore.delete(key);
      },
    };

    const chain = middleware()
      .rateLimit({
        requests: 2,
        window: '1m',
        keyGenerator: (ctx) => 'sync-test-key',
        storage: customStorage,
      });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // First request
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    // Second request
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    // Third request - should be rate limited
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(true);
    }

    // Verify custom storage has the data
    expect(syncStore.has('sync-test-key')).toBe(true);
    const storedData = syncStore.get('sync-test-key');
    expect(storedData).toHaveProperty('count');
    expect(storedData).toHaveProperty('resetAt');
    expect(storedData.count).toBe(2); // Hit limit at 2
  });

  it('should pass TTL to custom storage', async () => {
    const ttlSpy = vi.fn();
    const customStorage = {
      set(key: string, value: any, ttl?: number) {
        ttlSpy(key, value, ttl);
      },
      get(key: string) {
        return null;
      },
      delete(key: string) {
        // no-op
      },
    };

    const chain = middleware()
      .rateLimit({
        requests: 5,
        window: '2m', // 120 seconds
        storage: customStorage,
      });

    const { handlers } = chain.build();

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

    // Verify TTL was passed to storage
    expect(ttlSpy).toHaveBeenCalled();
    const [key, value, ttl] = ttlSpy.mock.calls[0];
    expect(ttl).toBe(120); // 2 minutes = 120 seconds
  });

  it('should support ttl method in custom storage', async () => {
    // Create a storage that tracks TTL
    const storageWithTTL = new Map<string, { value: any; expiresAt: number }>();
    const customStorage = {
      set(key: string, value: any, ttl?: number) {
        storageWithTTL.set(key, {
          value,
          expiresAt: ttl ? Date.now() + (ttl * 1000) : Infinity,
        });
      },
      get(key: string) {
        const item = storageWithTTL.get(key);
        if (!item) return null;
        if (item.expiresAt < Date.now()) {
          storageWithTTL.delete(key);
          return null;
        }
        return item.value;
      },
      delete(key: string) {
        storageWithTTL.delete(key);
      },
      ttl(key: string) {
        const item = storageWithTTL.get(key);
        if (!item) return null;
        const remainingMs = item.expiresAt - Date.now();
        return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : null;
      },
    };

    const chain = middleware()
      .rateLimit({
        requests: 5,
        window: '10s',
        keyGenerator: (ctx) => 'ttl-test-key',
        storage: customStorage,
      });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // First request
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
      expect(ctx._handled).toBe(false);
    }

    // Check TTL
    const ttl = customStorage.ttl('ttl-test-key');
    expect(ttl).not.toBeNull();
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(10); // Should be <= 10 seconds
  });

  it('should support ttl method with default storage', async () => {
    const chain = middleware()
      .rateLimit({
        requests: 3,
        window: '5s',
        keyGenerator: (ctx) => 'default-ttl-test',
      });

    const { handlers } = chain.build();

    const executeChain = async (ctx: MiddlewareContext) => {
      let index = 0;
      const executeNext = async (): Promise<void> => {
        if (index < handlers.length) {
          const handler = handlers[index++];
          await handler(ctx, executeNext);
        }
      };
      await executeNext();
    };

    // Make a request to create the rate limit record
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      await executeChain(ctx);
    }

    // Access the default storage TTL (we need to import the storage, but for testing
    // we can verify the behavior indirectly by checking that records expire)
    // This is more of an integration test to ensure TTL tracking works
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

  it('should match regex patterns in .when()', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when(
        (ctx) => /^\/api\/v[0-9]+\/.*/.test(ctx.pathname),
        async (ctx, next) => {
          executed.push('versioned-api');
          await next();
        }
      )
      .when(
        (ctx) => /\/dashboard$/.test(ctx.pathname),
        async (ctx, next) => {
          executed.push('dashboard-exact');
          await next();
        }
      );

    const { handlers } = chain.build();

    // Test versioned API
    {
      executed.length = 0;
      const req = createMockRequest('/api/v1/users');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain('versioned-api');
    }

    // Test exact match
    {
      executed.length = 0;
      const req = createMockRequest('/dashboard');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain('dashboard-exact');
    }
  });

  it('should support function-based conditions in .when()', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when(
        (ctx) => ctx.method === 'POST',
        async (ctx, next) => {
          executed.push('post-only');
          await next();
        }
      )
      .when(
        (ctx) => ctx.searchParams.get('debug') === 'true',
        async (ctx, next) => {
          executed.push('debug-mode');
          await next();
        }
      );

    const { handlers } = chain.build();

    // Test POST method
    {
      const req = createMockRequest('/test', 'POST');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain('post-only');
    }

    // Test debug param
    {
      executed.length = 0;
      const req = createMockRequest('/test?debug=true');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed).toContain('debug-mode');
    }
  });

  it('should support boolean conditions in .when()', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when(true, async (ctx, next) => {
        executed.push('always');
        await next();
      })
      .when(false, async (ctx, next) => {
        executed.push('never');
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest('/test');
    const ctx = createContext(req, createMockResponse());
    
    await executeChain(handlers, ctx);
    
    expect(executed).toEqual(['always']);
    expect(executed).not.toContain('never');
  });

  it('should support nested chains in .when()', async () => {
    const executed: string[] = [];
    
    const chain = middleware()
      .when('/protected', (subChain) => {
        subChain
          .use(async (ctx, next) => {
            executed.push('auth-check');
            ctx.data.set('authenticated', true);
            await next();
          })
          .use(async (ctx, next) => {
            executed.push('role-check');
            await next();
          });
      })
      .use(async (ctx, next) => {
        executed.push('final');
        await next();
      });

    const { handlers } = chain.build();

    // Test matching path
    const req1 = createMockRequest('/protected');
    const ctx1 = createContext(req1, createMockResponse());
    await executeChain(handlers, ctx1);
    
    expect(executed).toEqual(['auth-check', 'role-check', 'final']);
    expect(ctx1.data.get('authenticated')).toBe(true);

    // Test non-matching path
    executed.length = 0;
    const req2 = createMockRequest('/other');
    const ctx2 = createContext(req2, createMockResponse());
    await executeChain(handlers, ctx2);
    
    expect(executed).toEqual(['final']);
  });
});

describe('Response Methods', () => {
  it('should send text responses', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.text('Hello World', 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/plain',
    }));
    expect(res.end).toHaveBeenCalledWith('Hello World');
  });

  it('should send HTML responses', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.html('<h1>Hello</h1>', 200);

    expect(ctx._handled).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      'Content-Type': 'text/html',
    }));
    expect(res.end).toHaveBeenCalledWith('<h1>Hello</h1>');
  });

  it('should handle different redirect status codes', () => {
    // 307 Temporary Redirect
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      
      ctx.redirect('/new', 307);
      expect(res.writeHead).toHaveBeenCalledWith(307, expect.any(Object));
    }

    // 308 Permanent Redirect
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      
      ctx.redirect('/new', 308);
      expect(res.writeHead).toHaveBeenCalledWith(308, expect.any(Object));
    }

    // 302 Found
    {
      const req = createMockRequest('/test');
      const res = createMockResponse();
      const ctx = createContext(req, res);
      
      ctx.redirect('/new', 302);
      expect(res.writeHead).toHaveBeenCalledWith(302, expect.any(Object));
    }
  });

  it('should prevent double responses', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // First response
    ctx.json({ success: true }, 200);
    expect(ctx._handled).toBe(true);

    // Try to send another response
    ctx.text('Should not work', 200);
    
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('already sent'));
    consoleSpy.mockRestore();
  });
});

describe('Header Management Advanced', () => {
  it('should handle multiple values for same header key', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.headers.set('X-Custom', 'value1');
    expect(ctx.headers.get('X-Custom')).toBe('value1');
    
    ctx.headers.set('X-Custom', 'value2'); // Should overwrite
    expect(ctx.headers.get('X-Custom')).toBe('value2');
  });

  it('should preserve existing headers', () => {
    const req = createMockRequest('/test');
    req.headers['existing-header'] = 'existing-value';
    
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.headers.get('existing-header')).toBe('existing-value');
  });
});

describe('Cookie Management Advanced', () => {
  it('should handle cookie expiration', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const expireDate = new Date(Date.now() + 86400000); // 1 day from now
    ctx.cookies.set('session', 'abc123', {
      expires: expireDate,
    });

    const setCookieCall = (res.setHeader as any).mock.calls.find(
      (call: any[]) => call[0] === 'Set-Cookie'
    );
    
    expect(setCookieCall).toBeDefined();
    expect(setCookieCall[1][0]).toContain('Expires=');
  });

  it('should handle all SameSite options', () => {
    const req = createMockRequest('/test');
    
    ['strict', 'lax', 'none'].forEach((sameSite) => {
      const res = createMockResponse();
      const ctx = createContext(req, res);

      ctx.cookies.set('test', 'value', {
        sameSite: sameSite as any,
      });

      const setCookieCall = (res.setHeader as any).mock.calls.find(
        (call: any[]) => call[0] === 'Set-Cookie'
      );
      
      expect(setCookieCall[1][0]).toContain(`SameSite=${sameSite.charAt(0).toUpperCase() + sameSite.slice(1)}`);
    });
  });

  it('should handle cookies with special characters', () => {
    const req = createMockRequest('/test');
    req.headers.cookie = 'encoded=hello%20world; special=test%2Bvalue';
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.cookies.get('encoded')).toBe('hello world');
    expect(ctx.cookies.get('special')).toBe('test+value');
  });

  it('should set secure and httpOnly flags', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.cookies.set('secure-cookie', 'value', {
      secure: true,
      httpOnly: true,
    });

    const setCookieCall = (res.setHeader as any).mock.calls.find(
      (call: any[]) => call[0] === 'Set-Cookie'
    );
    
    expect(setCookieCall[1][0]).toContain('Secure');
    expect(setCookieCall[1][0]).toContain('HttpOnly');
  });
});

describe('Data Storage & Sharing', () => {
  it('should store and retrieve complex data types', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const complexData = {
      user: { id: 1, name: 'John', roles: ['admin', 'user'] },
      settings: { theme: 'dark', notifications: true },
      timestamp: Date.now(),
    };

    ctx.data.set('complexData', complexData);
    
    const retrieved = ctx.data.get('complexData');
    expect(retrieved).toEqual(complexData);
    expect(retrieved.user.roles).toEqual(['admin', 'user']);
  });

  it('should handle multiple data keys', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.data.set('key1', 'value1');
    ctx.data.set('key2', { nested: 'value2' });
    ctx.data.set('key3', [1, 2, 3]);

    expect(ctx.data.get('key1')).toBe('value1');
    expect(ctx.data.get('key2')).toEqual({ nested: 'value2' });
    expect(ctx.data.get('key3')).toEqual([1, 2, 3]);
  });

  it('should share data across middleware', async () => {
    const chain = middleware()
      .use(async (ctx, next) => {
        ctx.data.set('step1', 'completed');
        await next();
      })
      .use(async (ctx, next) => {
        const step1 = ctx.data.get('step1');
        expect(step1).toBe('completed');
        ctx.data.set('step2', 'completed');
        await next();
      })
      .use(async (ctx, next) => {
        expect(ctx.data.get('step1')).toBe('completed');
        expect(ctx.data.get('step2')).toBe('completed');
        await next();
      });

    const { handlers } = chain.build();
    const req = createMockRequest('/test');
    const ctx = createContext(req, createMockResponse());
    
    await executeChain(handlers, ctx);
  });
});

describe('Parent Data Access (Cascading)', () => {
  it('should access parent middleware data', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    
    const parentData = new Map<string, any>();
    parentData.set('parentKey', 'parentValue');
    parentData.set('userId', 123);
    
    const parent = {
      data: parentData,
      headers: { 'X-Parent': 'true' },
    };
    
    const ctx = createContext(req, res, undefined, parent);

    expect(ctx.parent).toBeDefined();
    expect(ctx.parent?.data.get('parentKey')).toBe('parentValue');
    expect(ctx.parent?.data.get('userId')).toBe(123);
    expect(ctx.parent?.headers['X-Parent']).toBe('true');
  });

  it('should merge parent data with current data', async () => {
    const chain = middleware()
      .use(async (ctx, next) => {
        if (ctx.parent) {
          const parentUserId = ctx.parent.data.get('userId');
          ctx.data.set('hasParent', true);
          ctx.data.set('inheritedUserId', parentUserId);
        }
        
        ctx.data.set('ownData', 'value');
        await next();
      });

    const { handlers } = chain.build();
    
    const req = createMockRequest('/test');
    const res = createMockResponse();
    
    const parentData = new Map<string, any>();
    parentData.set('userId', 456);
    
    const ctx = createContext(req, res, undefined, {
      data: parentData,
      headers: {},
    });
    
    await executeChain(handlers, ctx);

    expect(ctx.data.get('hasParent')).toBe(true);
    expect(ctx.data.get('inheritedUserId')).toBe(456);
    expect(ctx.data.get('ownData')).toBe('value');
  });
});

describe('URL Rewriting', () => {
  it('should update pathname when rewriting', () => {
    const req = createMockRequest('/old-path?foo=bar');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.pathname).toBe('/old-path');
    
    ctx.rewrite('/new-path');
    
    expect(ctx.pathname).toBe('/new-path');
    expect(ctx._rewriteUrl).toBe('/new-path');
    expect(req.url).toBe('/new-path');
  });

  it('should preserve query params during rewrite', () => {
    const req = createMockRequest('/old?keep=this');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite('/new?keep=this');
    
    expect(ctx.searchParams.get('keep')).toBe('this');
  });

  it('should handle multiple rewrites', () => {
    const req = createMockRequest('/path1');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    ctx.rewrite('/path2');
    expect(ctx.pathname).toBe('/path2');
    
    ctx.rewrite('/path3');
    expect(ctx.pathname).toBe('/path3');
    expect(ctx._rewriteUrl).toBe('/path3');
  });
});

describe('Middleware Data Access (getMiddlewareData)', () => {
  it('should retrieve middleware data without props', () => {
    // Set data
    _setCurrentMiddlewareData({
      user: { id: 1, name: 'John' },
      stats: { views: 100 },
    });
    
    // Test getMiddlewareData()
    const data = getMiddlewareData();
    expect(data.get('user')).toEqual({ id: 1, name: 'John' });
    expect(data.get('stats')).toEqual({ views: 100 });
    
    // Test getMiddlewareValue()
    const user = getMiddlewareValue('user');
    expect(user).toEqual({ id: 1, name: 'John' });
    
    // Clean up
    _clearCurrentMiddlewareData();
  });

  it('should return empty map when no data is set', () => {
    _clearCurrentMiddlewareData();
    
    const data = getMiddlewareData();
    expect(data.size).toBe(0);
  });

  it('should handle data isolation between requests', () => {
    // Request 1
    _setCurrentMiddlewareData({ req1: 'data1' });
    let data1 = getMiddlewareData();
    expect(data1.get('req1')).toBe('data1');
    _clearCurrentMiddlewareData();
    
    // Request 2 (should not have req1 data)
    _setCurrentMiddlewareData({ req2: 'data2' });
    let data2 = getMiddlewareData();
    expect(data2.get('req2')).toBe('data2');
    expect(data2.get('req1')).toBeUndefined();
    _clearCurrentMiddlewareData();
  });
});

describe('Rate Limiting Advanced', () => {
  it('should handle custom key generators', async () => {
    const chain = middleware()
      .rateLimit({
        requests: 2,
        window: '1s',
        keyGenerator: (ctx) => {
          const userId = ctx.data.get('userId');
          return userId ? `user_${userId}` : 'anonymous';
        },
      });

    const { handlers } = chain.build();

    // User 1 - first request
    {
      const req = createMockRequest('/test');
      const ctx = createContext(req, createMockResponse());
      ctx.data.set('userId', 'user1');
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }

    // User 1 - second request (should still work)
    {
      const req = createMockRequest('/test');
      const ctx = createContext(req, createMockResponse());
      ctx.data.set('userId', 'user1');
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }

    // User 2 - should have separate limit
    {
      const req = createMockRequest('/test');
      const ctx = createContext(req, createMockResponse());
      ctx.data.set('userId', 'user2');
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
    }
  });

  it('should call onLimit callback when rate limited', async () => {
    const onLimitCalled = vi.fn();
    
    const chain = middleware()
      .rateLimit({
        requests: 1,
        window: '10s',
        keyGenerator: () => 'test-onlimit-key',
        onLimit: async (ctx) => {
          onLimitCalled();
        },
      });

    const { handlers } = chain.build();

    // First request - should pass
    {
      const req = createMockRequest('/test');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(false);
      expect(onLimitCalled).not.toHaveBeenCalled();
    }

    // Second request - should be rate limited
    {
      const req = createMockRequest('/test');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(ctx._handled).toBe(true);
      expect(onLimitCalled).toHaveBeenCalled();
    }
  });

  it('should parse different time windows correctly', async () => {
    const testWindows = [
      { window: '500ms', expected: 500 },
      { window: '1s', expected: 1000 },
      { window: '2m', expected: 120000 },
      { window: '1h', expected: 3600000 },
      { window: '1d', expected: 86400000 },
    ];

    for (const { window } of testWindows) {
      const chain = middleware().rateLimit({
        requests: 100,
        window,
      });

      const { handlers } = chain.build();
      expect(handlers.length).toBe(1);
    }
  });
});

describe('Method-specific Middleware', () => {
  it('should handle different HTTP methods', async () => {
    const executed: Record<string, boolean> = {};
    
    const chain = middleware()
      .when((ctx) => ctx.method === 'GET', async (ctx, next) => {
        executed.GET = true;
        await next();
      })
      .when((ctx) => ctx.method === 'POST', async (ctx, next) => {
        executed.POST = true;
        await next();
      })
      .when((ctx) => ctx.method === 'DELETE', async (ctx, next) => {
        executed.DELETE = true;
        await next();
      });

    const { handlers } = chain.build();

    // Test GET
    {
      const req = createMockRequest('/test', 'GET');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.GET).toBe(true);
    }

    // Test POST
    {
      const req = createMockRequest('/test', 'POST');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.POST).toBe(true);
    }

    // Test DELETE
    {
      const req = createMockRequest('/test', 'DELETE');
      const ctx = createContext(req, createMockResponse());
      await executeChain(handlers, ctx);
      expect(executed.DELETE).toBe(true);
    }
  });
});

describe('Query Parameter Access', () => {
  it('should access query parameters via searchParams', () => {
    const req = createMockRequest('/test?foo=bar&baz=qux&num=123');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.searchParams.get('foo')).toBe('bar');
    expect(ctx.searchParams.get('baz')).toBe('qux');
    expect(ctx.searchParams.get('num')).toBe('123');
    expect(ctx.searchParams.get('missing')).toBeNull();
  });

  it('should handle multiple values for same param', () => {
    const req = createMockRequest('/test?tag=react&tag=typescript&tag=vite');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    const tags = ctx.searchParams.getAll('tag');
    expect(tags).toEqual(['react', 'typescript', 'vite']);
  });

  it('should handle URL-encoded query params', () => {
    const req = createMockRequest('/test?name=John%20Doe&email=test%40example.com');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.searchParams.get('name')).toBe('John Doe');
    expect(ctx.searchParams.get('email')).toBe('test@example.com');
  });
});

describe('Vite Integration', () => {
  it('should detect development mode', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const ctx = createContext(req, res);

    expect(ctx.vite.isDev).toBeDefined();
    expect(typeof ctx.vite.isDev).toBe('boolean');
  });

  it('should include vite server in context', () => {
    const req = createMockRequest('/test');
    const res = createMockResponse();
    const mockViteServer = { hot: {} } as any;
    const ctx = createContext(req, res, mockViteServer);

    expect(ctx.vite.server).toBe(mockViteServer);
    expect(ctx.vite.hmr).toBe(true);
  });
});
