# Farm.js Architecture

This document provides an overview of the Farm.js framework architecture and design decisions.

## 🏗️ High-Level Architecture

Farm.js is built as a monorepo containing multiple packages that work together to provide a complete React meta-framework experience.

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Developer     │    │   Farm.js CLI   │    │   Vite Plugin   │
│   Experience    │◄──►│   (farm-cli)    │◄──►│   (farm/vite)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  File-based     │    │  Route Manager  │    │  Server         │
│  Routing        │◄──►│  (routing/)     │◄──►│  Renderer       │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  React Server   │    │  Client         │    │  Build          │
│  Components     │◄──►│  Hydration      │◄──►│  System         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📦 Package Structure

### Core Packages

#### `packages/farm/`
The main framework package containing:
- **Core Types** (`src/types.ts`) - TypeScript definitions for the entire framework
- **Route Manager** (`src/routing/`) - File-based routing system with Next.js-like semantics
- **Server Renderer** (`src/server/`) - RSC rendering and SSR capabilities
- **Client Runtime** (`src/client/`) - Client-side hydration and navigation
- **Vite Plugin** (`src/vite.ts`) - Integration with Vite build system
- **Utilities** (`src/utils.ts`) - Shared utility functions

#### `packages/farm-cli/`
Command-line interface for development:
- Development server (`farm dev`)
- Production builds (`farm build`)
- Project scaffolding integration

#### `packages/create-farm-app/`
Project creation tool:
- Interactive project setup
- Template system
- TypeScript/JavaScript options

### Supporting Infrastructure

#### `docs/`
Documentation website built with fumadocs:
- Getting started guides
- API reference
- Examples and tutorials
- Built with Next.js and fumadocs

#### `examples/`
Example applications showcasing different use cases:
- **basic/** - Simple Farm.js application
- **with-database/** - Database integration patterns
- **e-commerce/** - Full-featured application

#### `playground/`
Development testing environment:
- Manual testing of framework features
- Browser-based verification
- Feature demonstration

## 🔄 Request Flow

### Development Mode

1. **Request arrives** at Vite dev server
2. **Vite middleware** intercepts non-asset requests
3. **Route Manager** matches URL to file-based routes
4. **Server Renderer** loads and renders React Server Components
5. **HTML response** is streamed to the client with RSC payload
6. **Client runtime** hydrates the application

### Production Mode

1. **Build process** generates optimized bundles
2. **Static analysis** discovers all routes and dependencies
3. **Server bundle** contains RSC rendering logic
4. **Client bundle** contains hydration and navigation code
5. **Runtime** serves pre-built or dynamically rendered pages

## 🎯 Design Principles

### 1. Next.js Compatibility
- File-based routing with `page.tsx` and `layout.tsx`
- App Router-style directory structure
- Compatible TypeScript types and patterns
- Familiar developer experience

### 2. Vite Integration
- Leverages Vite's fast development server
- Uses Vite's plugin system for customization
- Benefits from Vite's optimized build process
- Maintains Vite's excellent DX

### 3. React Server Components
- Full RSC support with streaming
- Server and client component boundaries
- Optimized data fetching patterns
- Progressive enhancement approach

### 4. AI-Friendly Architecture
- Predictable file structure and naming
- Clear separation of concerns
- Consistent patterns throughout
- Well-documented APIs and types

## 🔧 Key Components

### Route Manager (`src/routing/route-manager.ts`)

Responsible for:
- Discovering routes from file system
- Parsing dynamic route segments
- Matching URLs to route handlers
- Loading route modules dynamically

```typescript
// Example route matching
const { route, params, layouts } = routeManager.matchRoute('/users/123')
// Returns: { route: UserPage, params: { id: '123' }, layouts: [RootLayout] }
```

### Server Renderer (`src/server/renderer.ts`)

Handles:
- React Server Component rendering
- HTML streaming with RSC payload
- Layout composition and nesting
- Error boundaries and 404 handling

### Vite Plugin (`src/vite.ts`)

Provides:
- Development middleware integration
- Client/server code splitting
- RSC module resolution
- Build-time optimizations

### Client Runtime (`src/client/`)

Manages:
- Application hydration
- Client-side navigation
- Route transitions
- State management

## 🧪 Testing Strategy

### Unit Tests
- Utility functions (route parsing, matching)
- Core logic components
- Type safety verification

### Integration Tests
- Route discovery and matching
- Server rendering pipeline
- Client hydration process

### Manual Testing
- Playground application
- Example applications
- Browser compatibility

## 🚀 Performance Considerations

### Development Performance
- Vite's instant server start
- Fast HMR with file watching
- Optimized module resolution
- Minimal build overhead

### Runtime Performance
- React Server Components reduce client bundle size
- Streaming SSR improves perceived performance
- Optimized hydration process
- Code splitting by route

### Build Performance
- Vite's optimized build pipeline
- Tree shaking and dead code elimination
- Efficient bundling strategies
- Parallel processing where possible

## 🔮 Future Enhancements

### Planned Features
- Server Actions implementation
- Enhanced metadata handling
- Middleware system
- Plugin ecosystem
- Edge runtime support

### Extensibility Points
- Custom Vite plugins
- Route middleware
- Custom renderers
- Build hooks
- Development tools

## 📚 Learning Resources

For developers wanting to understand or contribute to Farm.js:

1. **Start with the playground** - See the framework in action
2. **Explore examples** - Understand common patterns
3. **Read the source** - Core logic is well-documented
4. **Run tests** - Understand expected behavior
5. **Check documentation** - Comprehensive guides and API reference

This architecture provides a solid foundation for a modern React meta-framework while maintaining simplicity and extensibility.

