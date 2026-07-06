---
title: "Supabase Integration"
description: "Use Supabase auth sessions, callback routes, and protected Farm routes."
section: "Integrations"
---

# Supabase Integration

Supabase brings hosted auth, Postgres-backed user data, OAuth providers, magic links, and session helpers into Farm's integration API.

## Add Supabase

**Terminal**

```bash
farm add integration supabase --ui
```

## Configure

**src/lib/integrations.ts**

```ts
import { supabase } from "@farmjs/integrations/supabase";

export const integrations = {
  auth: supabase({
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    callbackUrl: "/auth/callback",
  }),
};
```

## Use it

**Caller**

```ts
const session = await api.auth.session.get();
```
