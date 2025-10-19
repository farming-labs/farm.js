# 🔄 Sharing Data from Middleware to Pages

## ✅ **Yes! Middleware can share data with pages!**

Farm.js provides **multiple ways** to pass data from middleware to your page components.

---

## 🎯 **Method 1: Page Props (Recommended)** ✨

The **easiest and most direct** way - middleware data is automatically available in page props!

### Middleware (`src/app/dashboard/middleware.ts`):
```typescript
import { middleware } from 'farm/middleware';

export default middleware()
  .use(async (ctx, next) => {
    // Set data in middleware
    ctx.data.set('user', {
      id: 1,
      name: 'John Doe',
      email: 'john@example.com'
    });
    
    ctx.data.set('dashboardStats', {
      views: 1234,
      clicks: 567
    });
    
    await next();
  });
```

### Page (`src/app/dashboard/page.tsx`):
```typescript
import type { PageProps } from 'farm';

export default async function DashboardPage(props: PageProps) {
  // Access middleware data through page props!
  const middlewareData = props.middleware ? await props.middleware : new Map();
  
  const user = middlewareData.get('user');
  const stats = middlewareData.get('dashboardStats');
  
  return (
    <div>
      <h1>Welcome {user?.name}!</h1>
      <p>Email: {user?.email}</p>
      <p>Views: {stats?.views}</p>
      <p>Clicks: {stats?.clicks}</p>
    </div>
  );
}
```

---

## 🎯 **Method 2: Helper Functions**

Use the built-in helper functions for cleaner code:

```typescript
import { getMiddlewareData, getMiddlewareValue } from 'farm/middleware';

export default async function DashboardPage() {
  // Get all middleware data
  const data = await getMiddlewareData();
  const user = data.get('user');
  
  // Or get a specific value directly
  const stats = await getMiddlewareValue('dashboardStats');
  
  return (
    <div>
      <h1>Welcome {user?.name}!</h1>
      <p>Views: {stats?.views}</p>
    </div>
  );
}
```

---

## 🎯 **Method 3: Type-Safe Accessor** (Best for Large Apps)

For **full type safety**, create a typed accessor:

### Define your middleware data types:
```typescript
// lib/middleware-types.ts
export interface MiddlewareData {
  user: {
    id: number;
    name: string;
    email: string;
    role: 'admin' | 'user';
  };
  session: {
    id: string;
    expiresAt: Date;
  };
  dashboardStats: {
    views: number;
    clicks: number;
    revenue: number;
  };
  permissions: string[];
  featureFlags: {
    newUI: boolean;
    darkMode: boolean;
  };
}
```

### Create accessor:
```typescript
// lib/get-middleware-data.ts
import { createMiddlewareAccessor } from 'farm/middleware';
import type { MiddlewareData } from './middleware-types';

export const getTypedMiddlewareData = createMiddlewareAccessor<MiddlewareData>();
```

### Use in pages with full type safety:
```typescript
import { getTypedMiddlewareData } from '@/lib/get-middleware-data';

export default async function DashboardPage() {
  const data = await getTypedMiddlewareData();
  
  // ✅ Fully typed!
  const user = data.user;        // Type: { id: number; name: string; ... }
  const stats = data.dashboardStats;  // Type: { views: number; clicks: number; ... }
  const flags = data.featureFlags;    // Type: { newUI: boolean; darkMode: boolean }
  
  // TypeScript knows these properties exist!
  return (
    <div>
      <h1>Welcome {user?.name}</h1>
      {flags?.newUI && <NewDashboard stats={stats} />}
      {!flags?.newUI && <OldDashboard stats={stats} />}
    </div>
  );
}
```

---

## 💡 **Real-World Example: Dashboard with Auth**

### Middleware:
```typescript
// src/app/dashboard/middleware.ts
import { middleware } from 'farm/middleware';
import { getUser, getPermissions, getDashboardStats } from '@/lib/db';

export default middleware()
  // 1. Authenticate
  .use(async (ctx, next) => {
    const sessionToken = ctx.cookies.get('session');
    if (!sessionToken) {
      return ctx.redirect('/login');
    }
    
    const user = await getUser(sessionToken);
    if (!user) {
      return ctx.redirect('/login');
    }
    
    ctx.data.set('user', user);
    await next();
  })
  
  // 2. Load permissions
  .use(async (ctx, next) => {
    const user = ctx.data.get('user');
    const permissions = await getPermissions(user.id);
    ctx.data.set('permissions', permissions);
    await next();
  })
  
  // 3. Preload dashboard data
  .use(async (ctx, next) => {
    const user = ctx.data.get('user');
    const stats = await getDashboardStats(user.id);
    ctx.data.set('stats', stats);
    await next();
  });
```

### Page:
```typescript
// src/app/dashboard/page.tsx
import type { PageProps } from 'farm';

export default async function DashboardPage(props: PageProps) {
  const data = props.middleware ? await props.middleware : new Map();
  
  const user = data.get('user');
  const permissions = data.get('permissions');
  const stats = data.get('stats');
  
  // All data preloaded by middleware - no database calls needed!
  return (
    <div>
      <h1>Welcome back, {user.name}!</h1>
      
      {permissions.includes('admin') && (
        <AdminPanel />
      )}
      
      <StatsCards stats={stats} />
    </div>
  );
}
```

---

## 📊 **What Data Gets Shared?**

**ALL data** you set in `ctx.data` is available:

```typescript
// In middleware.ts
ctx.data.set('user', { id: 1, name: 'John' });
ctx.data.set('session', { token: 'abc' });
ctx.data.set('preferences', { theme: 'dark' });
ctx.data.set('notifications', [{ id: 1, message: 'Hi' }]);
ctx.data.set('anything', 'you want!');

// In page.tsx  
const data = await props.middleware;
data.get('user')          // { id: 1, name: 'John' }
data.get('session')       // { token: 'abc' }
data.get('preferences')   // { theme: 'dark' }
data.get('notifications') // [{ id: 1, message: 'Hi' }]
data.get('anything')      // 'you want!'
```

---

## 🔥 **Cascading Data Example**

Root middleware → Page middleware → Page component!

```typescript
// src/app/middleware.ts (ROOT)
export default middleware()
  .use(async (ctx, next) => {
    ctx.data.set('globalUser', await getUser());
    await next();
  });

// src/app/dashboard/middleware.ts (PAGE)
export default middleware()
  .use(async (ctx, next) => {
    // Access parent middleware data!
    const user = ctx.parent?.data.get('globalUser');
    
    // Add dashboard-specific data
    ctx.data.set('dashboardStats', await getStats(user.id));
    await next();
  });

// src/app/dashboard/page.tsx
export default async function DashboardPage(props: PageProps) {
  const data = await props.middleware;
  
  // Has data from BOTH root and page middleware!
  const user = data.get('globalUser');       // From root middleware
  const stats = data.get('dashboardStats');  // From page middleware
  
  return <div>...</div>;
}
```

---

## ✨ **Benefits**

1. **No Prop Drilling** - Data flows automatically from middleware to page
2. **Preload Data** - Fetch in middleware, use instantly in page
3. **Type-Safe** - Use `createMiddlewareAccessor<T>()` for full type safety
4. **Cascading** - Parent middleware data available in child middleware
5. **Performance** - Data fetched once in middleware, reused in page

---

## 📝 **Quick Reference**

| Method | Code | Type Safety |
|--------|------|-------------|
| **Page Props** | `await props.middleware` | ⚠️ Manual |
| **Helper Function** | `await getMiddlewareValue('key')` | ⚠️ Manual |
| **Typed Accessor** | `await getTypedData()` | ✅ Full |

---

## 🎯 **Complete Working Example**

**Visit** `http://localhost:3000/farm-query-demo` and you'll see:

```
🔥 Middleware Data (from middleware.ts)
Message: This data was set by middleware!
Timestamp: 2025-10-19T21:43:58.486Z
Data Size: 1 items

All Middleware Data:
{
  "demoInfo": {
    "message": "This data was set by middleware!",
    "timestamp": "2025-10-19T21:43:58.486Z"
  }
}
```

**This is live and working right now!** ✅

---

_Documentation created: October 19, 2025_ 🎊

