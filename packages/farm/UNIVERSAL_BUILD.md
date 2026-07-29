# Universal Build Architecture

Farm.js now supports a universal build pattern inspired by TanStack Start, which uses Web Standard APIs throughout and builds SSR bundles in memory.

## Core Principles

1. **User code uses Web Standard APIs** (Request, Response)
2. **Build-time adapter converts to platform-specific code** (via Nitro)
3. **No platform-specific code in userland**
4. **SSR bundle built in memory** (write: false) - no disk I/O during build
5. **Virtual bundle plugin exposes in-memory modules to Nitro**

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    User Code                            │
│  Uses Web Standard APIs (Request/Response)             │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Server Entry (server-entry.ts)            │
│  Exports: { fetch: RequestHandler }                    │
│  - Handles API routes                                  │
│  - Handles SSR routes                                  │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│            Vite Build (SSR in memory)                  │
│  - write: false (keeps bundle in memory)                │
│  - Captures bundle via generateBundle hook              │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│          Virtual Bundle Plugin                          │
│  - Exposes in-memory modules to Nitro                  │
│  - Resolves imports from bundle                        │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│              Nitro Virtual Entry                        │
│  - Wraps Web Standard handler with fromWebHandler      │
│  - Generates platform-specific adapters                │
└──────────────────┬──────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────┐
│         Platform-Specific Output                       │
│  - Vercel, Netlify, Node.js, Cloudflare, etc.         │
└─────────────────────────────────────────────────────────┘
```

## Implementation Files

### 1. Request Handler (`nitro/request-handler.ts`)

- Wraps Web Standard handlers with h3 context (optional)
- Provides AsyncLocalStorage for h3 utilities
- Exports `RequestHandler` type and `requestHandler` function

### 2. Handler Factory (`nitro/create-handler.ts`)

- Creates handlers from callbacks
- Handles errors and converts to Responses
- Wraps with requestHandler for h3 support

### 3. Server Entry (`nitro/server-entry.ts`)

- Default handler for Farm.js
- Handles both API and SSR routes
- Uses global registry for managers
- Exports `{ fetch: RequestHandler }`

### 4. Virtual Bundle Plugin (`nitro/virtual-bundle-plugin.ts`)

- Exposes in-memory Vite bundle to Nitro
- Resolves module imports from bundle
- Handles source maps

### 5. Universal Build (`nitro/universal-build.ts`)

- Builds client bundle to disk
- Builds SSR bundle in memory (write: false)
- Uses virtual bundle plugin with Nitro
- Creates virtual entry wrapping Web Standard handler

### 6. Vite Plugin (`nitro/vite-plugin.ts`)

- Optional: Can be used with Vite's builder API
- Captures SSR bundle during build
- Orchestrates Nitro build

## Usage

### Building with Universal Pattern

The universal build is now the **default** build method:

```typescript
import { build } from "@farm.js/core/build";

await build(config, {
  preset: "vercel", // or 'netlify', 'node-server', etc.
  universal: true, // default, can be set to false for legacy
});
```

### How It Works

1. **Client Build**: Vite builds client bundle to `.farm/client/`
2. **SSR Build (In Memory)**:
   - Vite builds SSR bundle with `write: false`
   - Bundle is captured via `generateBundle` hook
   - Entry point is `server-entry.ts` which exports a Web Standard fetch handler
3. **Nitro Build**:
   - Virtual bundle plugin exposes in-memory SSR modules
   - Virtual entry wraps handler: `fromWebHandler(handler.fetch)`
   - Nitro generates platform-specific adapters
   - Output goes to `.farm/.output/`

### Manager Initialization

Route managers, API route managers, and server renderers are stored in `globalThis.__FARM_REGISTRY__` during build. They're available at runtime through the global registry.

For serverless environments:

- Managers persist in global scope within the same function instance
- Each cold start initializes fresh, but warm starts reuse the global scope

## Benefits

1. **Faster Builds**: No disk I/O for SSR bundle
2. **Web Standards**: User code uses Request/Response APIs
3. **Platform Agnostic**: Nitro handles platform-specific adapters
4. **Better DX**: Cleaner separation of concerns
5. **Smaller Bundles**: Virtual bundle plugin only includes what's needed

## Migration Notes

- The universal build is now the default
- Legacy build pattern still available via `universal: false`
- All existing functionality is preserved
- No breaking changes to user-facing APIs

## Testing Checklist

- [ ] Build completes successfully
- [ ] Client bundle is generated correctly
- [ ] SSR bundle is built in memory
- [ ] Virtual bundle plugin resolves modules
- [ ] Nitro generates correct platform output
- [ ] API routes work correctly
- [ ] SSR routes render correctly
- [ ] Works with Vercel preset
- [ ] Works with Netlify preset
- [ ] Works with Node.js preset
