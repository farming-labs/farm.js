# 🔌 Plugin Import Examples

## ✅ **How to Import Farm.js Plugins**

### **From `farm/server/plugins`**

```typescript
// farm.config.ts
import { defineFarmConfig } from 'farm';
import {
  createRedirectsPlugin,
  createHeadersPlugin,
  createRewritesPlugin,
  createLoggerPlugin,
} from 'farm/server/plugins';

import type {
  RedirectConfig,
  HeaderConfig,
  FarmPlugin,
} from 'farm/server/plugins';

// Create custom redirect configs
const redirects: RedirectConfig[] = [
  { source: '/docs', destination: '/documentation', permanent: true },
  { source: '/api/v1/:path*', destination: '/api/v2/:path*', permanent: false },
];

// Use built-in plugins directly
export default defineFarmConfig({
  plugins: [
    createRedirectsPlugin(redirects),
    createHeadersPlugin([
      {
        source: '/:path*',
        headers: [{ key: 'X-Custom', value: 'Farm.js' }],
      },
    ]),
    createLoggerPlugin(), // Built-in request logger
  ],
});
```

---

### **From `farm/client/plugins`**

```typescript
// farm.config.ts
import { defineFarmConfig } from 'farm';
import { definePlugin } from 'farm/client/plugins';
import type { FarmPlugin, FarmPluginContext } from 'farm/client/plugins';

// Create your own plugin
const authPlugin: FarmPlugin = definePlugin({
  name: 'auth-plugin',
  enforce: 'pre',

  async beforeRequest(req, res, context) {
    const token = req.headers['authorization'];
    if (!token) {
      res.writeHead(401);
      res.end('Unauthorized');
    }
  },
});

export default defineFarmConfig({
  plugins: [authPlugin],
});
```

---

### **Mixing Both**

```typescript
import { defineFarmConfig } from 'farm';

// Server plugins (built-in)
import { 
  createRedirectsPlugin,
  createHeadersPlugin,
} from 'farm/server/plugins';

// Client plugins (custom)
import { definePlugin } from 'farm/client/plugins';

export default defineFarmConfig({
  plugins: [
    // Built-in server plugins
    createRedirectsPlugin([
      { source: '/old', destination: '/new', permanent: true },
    ]),
    
    createHeadersPlugin([
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ]),
    
    // Custom plugins
    definePlugin({
      name: 'custom-logger',
      async beforeRequest(req, res, context) {
        console.log(`📥 ${req.method} ${req.url}`);
      },
      async afterResponse(req, res, context) {
        console.log(`📤 ${res.statusCode}`);
      },
    }),
  ],
});
```

---

## 📦 **Available Imports**

### `farm/server/plugins`
- ✅ `createRedirectsPlugin(redirects[])`
- ✅ `createHeadersPlugin(headers[])`
- ✅ `createRewritesPlugin(rewrites[])`
- ✅ `createEnvPlugin(env{})`
- ✅ `createCompressionPlugin()`
- ✅ `createLoggerPlugin()` 

### `farm/client/plugins`
- ✅ `definePlugin(plugin)`
- ✅ `FarmPlugin` (type)
- ✅ `FarmPluginContext` (type)

### `farm` (main exports)
- ✅ `defineFarmConfig(config)`
- ✅ `definePlugin(plugin)`
- ✅ `FarmUserConfig` (type)
- ✅ All config types

---

## ✨ **Benefits**

1. **Tree-shakable** - Import only what you need
2. **Type-safe** - Full TypeScript support
3. **Organized** - Server vs Client plugin separation
4. **Discoverable** - Clear import paths
5. **Flexible** - Mix built-in and custom plugins

---

**Now you can easily import and use Farm.js plugins!** 🚜

