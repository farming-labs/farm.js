import type { EntryContext } from "../types.js";

/**
 * Generates the RSC environment entry file.
 *
 * This entry file:
 * - Auto-discovers page files using import.meta.glob
 * - Implements file-based routing by matching URL paths to page files
 * - Handles server actions if enabled (decoding arguments, executing, returning results)
 * - Renders the React tree to an RSC stream
 * - Either returns the stream directly (for client navigation) or delegates to SSR (for initial page load)
 */
export function generateRscEntry(ctx: EntryContext): string {
  // Build the glob pattern for discovering routes (Farm convention: src/app when routesDir unset)
  const appSegment = ctx.routesDir === undefined ? "app" : ctx.routesDir.trim();
  const glob = appSegment ? `/${ctx.srcDir}/${appSegment}` : `/${ctx.srcDir}`;
  const routeRoots = ctx.routeRoots?.length
    ? ctx.routeRoots
    : [{ name: "project", base: glob, glob }];

  const debugLog = `// Debug disabled`;
  let code = `
import React from 'react';
import {
  renderToReadableStream,
`;
  if (ctx.actionsEnabled) {
    code += `
  decodeReply,
  loadServerAction,
  decodeAction,
  decodeFormState,
  createTemporaryReferenceSet,
`;
  }
  code += `} from '@vitejs/plugin-rsc/rsc';
`;
  if (ctx.actionsEnabled) {
    code += `import {
  createServerActionRequestErrorResponse,
  prepareServerActionRequest,
  runWithServerActionRequest,
  sanitizeServerActionError,
  validateServerActionRequest,
} from '@farmjs/core/server-action-security';

const serverActionSecurity = ${JSON.stringify(ctx.serverActions)};
`;
  }

  // Auto-discover pages, layouts, and middleware using Vite's glob import
  code += `
// Debug logging helper
function debug(...args) {
  ${debugLog}
}

function applyActionResponseHeaders(headers, request) {
  if (${ctx.actionsEnabled ? "true" : "false"} && request.method === 'POST') {
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
  }
}

// Auto-discover all route modules. Every glob remains a literal so Vite can analyze it.
${routeRoots
  .map(
    (
      root,
      index,
    ) => `const pages${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/page.{tsx,jsx,ts,js}`)}, { eager: true });
const layouts${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/layout.{tsx,jsx,ts,js}`)}, { eager: true });
const loadings${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/loading.{tsx,jsx,ts,js}`)}, { eager: true });
const errors${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/error.{tsx,jsx,ts,js}`)}, { eager: true });
const middlewares${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/middleware.{tsx,jsx,ts,js}`)}, { eager: true });`,
  )
  .join("\n")}

function mergeRouteModules(sources) {
  const merged = {};
  for (const source of sources) {
    const baseValue = source.base.replace(/\\\\/g, '/').replace(/^\\.\\//, '');
    const normalizedBase = baseValue.endsWith('/') ? baseValue.slice(0, -1) : baseValue;
    for (const [filePath, module] of Object.entries(source.modules)) {
      const normalizedFile = filePath.replace(/\\\\/g, '/').replace(/^\\.\\//, '');
      const baseIndex = normalizedFile.indexOf(normalizedBase);
      let relative = baseIndex === -1
        ? normalizedFile
        : normalizedFile.slice(baseIndex + normalizedBase.length);
      if (!relative.startsWith('/')) relative = '/' + relative;
      merged[relative] = module;
    }
  }
  return merged;
}

const pages = mergeRouteModules([${routeRoots
    .map((root, index) => `{ base: ${JSON.stringify(root.base)}, modules: pages${index} }`)
    .join(", ")}]);
const layouts = mergeRouteModules([${routeRoots
    .map((root, index) => `{ base: ${JSON.stringify(root.base)}, modules: layouts${index} }`)
    .join(", ")}]);
const loadings = mergeRouteModules([${routeRoots
    .map((root, index) => `{ base: ${JSON.stringify(root.base)}, modules: loadings${index} }`)
    .join(", ")}]);
const errors = mergeRouteModules([${routeRoots
    .map((root, index) => `{ base: ${JSON.stringify(root.base)}, modules: errors${index} }`)
    .join(", ")}]);
const middlewares = mergeRouteModules([${routeRoots
    .map((root, index) => `{ base: ${JSON.stringify(root.base)}, modules: middlewares${index} }`)
    .join(", ")}]);

debug('Discovered pages:', Object.keys(pages));
debug('Discovered layouts:', Object.keys(layouts));
debug('Discovered loadings:', Object.keys(loadings));
debug('Discovered errors:', Object.keys(errors));
debug('Discovered middlewares:', Object.keys(middlewares));

/**
 * Convert loading/error file path to route pattern (segment the boundary applies to).
 * Inlined to avoid runtime dependency on plugin package; logic is simple and covered by e2e.
 */
function boundaryPathToRoute(filePath, globVal, kind) {
  const re = kind === 'loading' ? /\\/loading\\.[tj]sx?$/i : /\\/error\\.[tj]sx?$/i;
  let route = filePath.replace(globVal, '').replace(re, '').replace(/\\\\/g, '/') || '/';
  route = route.replace(/\\[([^\\]]+)\\]/g, ':$1');
  return route;
}
function getMatchingLoading(pathname, globVal) {
  const normalized = pathname.replace(/\\/$/, '') || '/';
  const pathParts = normalized.split('/').filter(Boolean);
  let best = null, bestLength = -1;
  for (const filePath of Object.keys(loadings)) {
    const pattern = boundaryPathToRoute(filePath, globVal, 'loading');
    const patternParts = pattern === '/' ? [] : pattern.split('/').filter(Boolean);
    if (patternParts.length > pathParts.length) continue;
    let matches = true;
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i], seg = pathParts[i];
      if (!seg || (p.startsWith(':') && p !== ':...') || p === ':...') continue;
      if (!p.startsWith(':') && p !== seg) { matches = false; break; }
    }
    if (matches && patternParts.length > bestLength && loadings[filePath]?.default) {
      best = loadings[filePath].default; bestLength = patternParts.length;
    }
  }
  return best;
}
function getMatchingError(pathname, globVal) {
  const normalized = pathname.replace(/\\/$/, '') || '/';
  const pathParts = normalized.split('/').filter(Boolean);
  let best = null, bestLength = -1;
  for (const filePath of Object.keys(errors)) {
    const pattern = boundaryPathToRoute(filePath, globVal, 'error');
    const patternParts = pattern === '/' ? [] : pattern.split('/').filter(Boolean);
    if (patternParts.length > pathParts.length) continue;
    let matches = true;
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i], seg = pathParts[i];
      if (!seg || (p.startsWith(':') && p !== ':...') || p === ':...') continue;
      if (!p.startsWith(':') && p !== seg) { matches = false; break; }
    }
    if (matches && patternParts.length > bestLength && errors[filePath]?.default) {
      best = errors[filePath].default; bestLength = patternParts.length;
    }
  }
  return best;
}

/**
 * Convert middleware file path to route path
 * e.g., '/src/middleware.ts' -> '/'
 * e.g., '/src/counter/middleware.ts' -> '/counter'
 */
function middlewarePathToRoute(filePath) {
  let route = filePath
    .replace('', '')
    .replace(/\\/middleware\\.[tj]sx?$/, '') || '/';
  return route;
}

/**
 * Get all applicable middleware for a pathname (from root to most specific)
 */
function getApplicableMiddleware(pathname) {
  const applicable = [];
  const normalizedPath = pathname.replace(/\\/$/, '') || '/';
  
  for (const [filePath, module] of Object.entries(middlewares)) {
    const mwPath = middlewarePathToRoute(filePath);
    
    // Root middleware (/) applies to everything
    // Other middleware applies to their path and sub-paths
    if (mwPath === '/' || normalizedPath.startsWith(mwPath) || normalizedPath === mwPath) {
      applicable.push({
        path: mwPath,
        filePath,
        module,
        config: module.config,
      });
    }
  }
  
  // Sort by path depth (root first, then nested)
  applicable.sort((a, b) => {
    const depthA = a.path.split('/').filter(Boolean).length;
    const depthB = b.path.split('/').filter(Boolean).length;
    return depthA - depthB;
  });
  
  return applicable;
}

/**
 * Create a middleware context
 */
function createMiddlewareContext(request, url) {
  return {
    method: request.method,
    url: url.href,
    pathname: url.pathname,
    searchParams: url.searchParams,
    headers: new Map(),
    data: new Map(),
    request,
  };
}

/**
 * Execute middleware chain for a request
 * Returns { handled: boolean, ctx: context } 
 */
async function executeMiddleware(request, url) {
  const applicable = getApplicableMiddleware(url.pathname);
  
  if (applicable.length === 0) {
    return { handled: false, ctx: createMiddlewareContext(request, url) };
  }
  
  const startTime = Date.now();
  const method = request.method || 'GET';
  
  // Log middleware execution in [FARM] [MIDDLEWARE] [METHOD] format
  try {
    const picoModule = await import('picocolors');
    const pico = picoModule.default || picoModule;
    const pc = typeof pico.createColors === 'function' ? pico.createColors(true) : pico;
    const logMsg = [
      pc.dim('[') + pc.bold(pc.blue('FARM')) + pc.dim(']'),
      pc.dim('[') + pc.bold(pc.magenta('MIDDLEWARE')) + pc.dim(']'),
      pc.dim('[') + pc.bold(pc.white(method.padEnd(3))) + pc.dim(']'),
      pc.gray('Executing middleware: '),
      pc.gray(url.pathname),
      pc.dim(' (' + applicable.length + ' middleware)'),
    ].join(' ');
    console.log(logMsg);
  } catch {
    console.log('[FARM] [MIDDLEWARE] [' + method + '] Executing middleware: ' + url.pathname + ' (' + applicable.length + ' middleware)');
  }
  
  let ctx = createMiddlewareContext(request, url);
  
  for (const mw of applicable) {
    const module = mw.module;
    let handlers = [];
    
    // Get handlers from the middleware module
    if (module.default) {
      const defaultExport = module.default;
      
      // Check if it has a build method (middleware chain object)
      if (typeof defaultExport === 'object' && 'build' in defaultExport) {
        if (typeof defaultExport.setBasePath === 'function') {
          defaultExport.setBasePath(mw.path);
        }
        const built = defaultExport.build();
        handlers = built.handlers || [];
      } else if (typeof defaultExport === 'function') {
        handlers = [defaultExport];
      }
    }
    
    // Execute handlers in sequence
    for (const handler of handlers) {
      let nextCalled = false;
      const next = async () => { nextCalled = true; };
      
      try {
        await handler(ctx, next);
      } catch (err) {
        console.error('[Middleware] Error in', mw.path, err);
        throw err;
      }
      
      // If next() was not called, middleware handled the request
      if (!nextCalled && ctx._response) {
        // Log middleware completion
        const duration = Date.now() - startTime;
        try {
          const picoModule2 = await import('picocolors');
          const pico2 = picoModule2.default || picoModule2;
          const pc2 = typeof pico2.createColors === 'function' ? pico2.createColors(true) : pico2;
          const logMsg = [
            pc2.dim('[') + pc2.bold(pc2.blue('FARM')) + pc2.dim(']'),
            pc2.dim('[') + pc2.bold(pc2.magenta('MIDDLEWARE')) + pc2.dim(']'),
            pc2.dim('[') + pc2.bold(pc2.white(method.padEnd(3))) + pc2.dim(']'),
            pc2.gray('Completed'),
            pc2.gray(url.pathname),
            pc2.dim('(' + duration + 'ms)'),
          ].join(' ');
          console.log(logMsg);
        } catch {
          console.log('[FARM] [MIDDLEWARE] [' + method + '] Completed ' + url.pathname + ' (' + duration + 'ms)');
        }
        return { handled: true, ctx, response: ctx._response };
      }
    }
  }
  
  // Log middleware completion
  const duration = Date.now() - startTime;
  try {
    const picoModule3 = await import('picocolors');
    const pico3 = picoModule3.default || picoModule3;
    const pc3 = typeof pico3.createColors === 'function' ? pico3.createColors(true) : pico3;
    const logMsg = [
      pc3.dim('[') + pc3.bold(pc3.blue('FARM')) + pc3.dim(']'),
      pc3.dim('[') + pc3.bold(pc3.magenta('MIDDLEWARE')) + pc3.dim(']'),
      pc3.dim('[') + pc3.bold(pc3.white(method.padEnd(3))) + pc3.dim(']'),
      pc3.gray('Completed'),
      pc3.gray(url.pathname),
      pc3.dim('(' + duration + 'ms)'),
    ].join(' ');
    console.log(logMsg);
  } catch {
    console.log('[FARM] [MIDDLEWARE] [' + method + '] Completed ' + url.pathname + ' (' + duration + 'ms)');
  }
  
  return { handled: false, ctx };
}

/**
 * Convert file path to route pattern
 * e.g., '/src/about/page.tsx' -> '/about'
 * e.g., '/src/blog/[slug]/page.tsx' -> '/blog/:slug'
 */
function filePathToRoute(filePath) {
  let route = filePath
    .replace('', '')
    .replace(/\\/page\\.[tj]sx?$/, '')
    .replace(/\\/page$/, '') || '/';
  
  // Convert [param] to :param for matching
  route = route.replace(/\\[([^\\]]+)\\]/g, ':$1');
  
  return route;
}

/**
 * Route-level error boundary (React class component for getDerivedStateFromError)
 * Next.js-style: error.tsx receives { error, reset }.
 */
const RouteErrorBoundary = React.Component
  ? class RouteErrorBoundary extends React.Component {
      static getDerivedStateFromError(error) {
        return { hasError: true, error };
      }
      constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
      }
      render() {
        if (this.state.hasError) {
          const Fallback = this.props.Fallback;
          const reset = () => this.setState({ hasError: false, error: null });
          return React.createElement(Fallback, { ...this.props.fallbackProps, error: this.state.error, reset });
        }
        return this.props.children;
      }
    }
  : function ServerPassthroughBoundary({ children }) {
      return children;
    };

/**
 * Match a URL pathname to a route pattern
 * Supports dynamic segments like :id and catch-all like *
 */
function matchPath(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  
  // Special case for root
  if (pattern === '/' && pathname === '/') {
    return { params: {} };
  }
  
  if (patternParts.length !== pathParts.length) {
    // Check for catch-all
    const lastPattern = patternParts[patternParts.length - 1];
    if (!lastPattern?.startsWith(':...')) {
      return null;
    }
  }
  
  const params = {};
  
  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];
    
    if (patternPart.startsWith(':...')) {
      // Catch-all segment
      const paramName = patternPart.slice(4);
      params[paramName] = pathParts.slice(i).join('/');
      return { params };
    }
    
    if (patternPart.startsWith(':')) {
      // Dynamic segment
      const paramName = patternPart.slice(1);
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      // Static segment mismatch
      return null;
    }
  }
  
  return { params };
}

/**
 * Simple file-based router
 * Converts URL pathname to matching page component
 */
function matchRoute(pathname) {
  const normalized = pathname.replace(/\\/$/, '') || '/';
  
  for (const filePath of Object.keys(pages)) {
    const pattern = filePathToRoute(filePath);
    const match = matchPath(pattern, normalized);
    
    if (match) {
      debug('Matched route:', pattern, 'for path:', normalized);
      return {
        Page: pages[filePath].default,
        pattern: filePath,
        params: match.params,
        metadata: pages[filePath].metadata,
      };
    }
  }
  
  debug('No route matched for:', normalized);
  return null;
}

/**
 * Find the layout for a given page file path (pattern from matchRoute = pages key).
 * Layer roots are normalized to virtual keys such as '/layout.tsx' and '/about/layout.tsx'.
 */
function getLayout(pageFilePath) {
  const tryKeys = (...keys) => {
    for (const k of keys) {
      if (layouts[k]?.default) return layouts[k].default;
    }
    return null;
  };
  const dir = pageFilePath.replace(/\\/page\\.[tj]sx?$/i, '');
  const extensions = ['tsx', 'jsx', 'ts', 'js'];

  // Layout next to page (try with/without leading slash to match glob keys)
  for (const ext of extensions) {
    const a = dir + '/layout.' + ext;
    const b = dir.startsWith('/') ? a : '/' + dir + '/layout.' + ext;
    const layout = tryKeys(a, b);
    if (layout) return layout;
  }

  // Walk up to parent layout
  const parts = dir.split('/').filter(Boolean);
  while (parts.length > 1) {
    parts.pop();
    const parentDir = '/' + parts.join('/');
    const relParent = parts.join('/');
    for (const ext of extensions) {
    const layout = tryKeys(parentDir + '/layout.' + ext, relParent + '/layout.' + ext);
    if (layout) return layout;
    }
  }

  // Root layout
  for (const ext of extensions) {
    const layout = tryKeys('/layout.' + ext, 'layout.' + ext);
    if (layout) return layout;
  }
  return null;
}

/**
 * Main request handler - entry point for both dev and production (Nitro).
 * Exported as { fetch: handler } for the RSC/Nitro contract (see vite-plugin-rsc-deploy-example).
 */
async function handler(request) {
  const url = new URL(request.url);
  try {
  debug('Handling request:', request.method, url.pathname);

  ${
    ctx.actionsEnabled
      ? `if (request.method === 'POST') {
    try {
      validateServerActionRequest(request, serverActionSecurity);
    } catch (error) {
      const rejection = createServerActionRequestErrorResponse(error);
      if (rejection) return rejection;
      return new Response('Bad Request', {
        status: 400,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
  }`
      : ""
  }

  // Execute middleware first
  const middlewareResult = await executeMiddleware(request, url);
  
  // If middleware handled the request (e.g., redirect, auth), return the response
  if (middlewareResult.handled && middlewareResult.response) {
    return middlewareResult.response;
  }
  
  // Extract middleware data and headers for page rendering
  const middlewareData = Object.fromEntries(middlewareResult.ctx.data);
  const middlewareHeaders = new Headers();
  for (const [key, value] of middlewareResult.ctx.headers) {
    middlewareHeaders.set(key, value);
  }
  
  const glob = '';
`;

  // If actions enabled, add action handling before rendering
  if (ctx.actionsEnabled) {
    code += `
  // Variables to hold action results
  let returnValue, formState, temporaryReferences;

  // Handle POST requests (server actions)
  if (request.method === 'POST') {
    const actionId = request.headers.get('x-farm-action-id');
    let preparedActionRequest;

    try {
      preparedActionRequest = await prepareServerActionRequest(
        request,
        serverActionSecurity,
        actionId ? 'javascript' : 'form',
        actionId,
      );
    } catch (error) {
      if (request.signal.aborted) {
        return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
      }
      const rejection = createServerActionRequestErrorResponse(error);
      if (rejection) return rejection;
      console.error('[Farm.js] Failed to read server action request:', error);
      return new Response('Bad Request', {
        status: 400,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    
    if (actionId) {
      // Action called via JavaScript (after hydration)
      debug('Executing server action:', actionId);
      temporaryReferences = createTemporaryReferenceSet();
      let args, action;

      try {
        args = await decodeReply(preparedActionRequest.body, { temporaryReferences });
        action = await loadServerAction(actionId);
      } catch (error) {
        console.error('[Farm.js] Invalid server action request:', error);
        return new Response('Bad Request', {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }

      try {
        const data = await runWithServerActionRequest(request, () => action.apply(null, args));
        returnValue = { ok: true, data };
        debug('Server action succeeded:', actionId);
      } catch (e) {
        if (request.signal.aborted) {
          return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
        }
        console.error('[Farm.js] Server action failed:', e);
        returnValue = { ok: false, data: sanitizeServerActionError(e) };
        debug('Server action failed:', actionId, e);
      }
    } else {
      // Progressive enhancement (form submitted before JS loaded)
      debug('Handling progressive enhancement form submission');
      const formData = preparedActionRequest.body;
      let decoded;

      try {
        decoded = await decodeAction(formData);
        if (typeof decoded !== 'function') throw new Error('Missing form action');
      } catch (error) {
        console.error('[Farm.js] Invalid form action request:', error);
        return new Response('Bad Request', {
          status: 400,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
      
      try {
        const result = await runWithServerActionRequest(request, () => decoded());
        formState = await decodeFormState(result, formData);
      } catch (e) {
        if (request.signal.aborted) {
          return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
        }
        console.error('[Farm.js] Form action failed:', e);
        debug('Form action failed:', e);
        return new Response('Server function failed', {
          status: 500,
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      }
    }
  }
`;
  }

  // Route matching and rendering
  code += `
  // Match the URL to a page component
  const matched = matchRoute(url.pathname);
  
  if (!matched) {
    debug('404 - No route found for:', url.pathname);
    return new Response('Not Found', { status: 404 });
  }
  
  const { Page, pattern, params, metadata } = matched;
  const Layout = getLayout(pattern) || (function PassThrough({ children }) { return children; });
  const configuredRoutesDir = ${ctx.routesDir === undefined ? "undefined" : JSON.stringify(ctx.routesDir)};
  const routesDir = configuredRoutesDir === undefined ? 'app' : configuredRoutesDir.trim();
  const routesPath = routesDir ? '/' + routesDir : '';
  const globalsCssPath = '/${ctx.srcDir}' + routesPath + '/globals.css';
  
  // Parse search params
  const searchParams = Object.fromEntries(url.searchParams);
  
  // Page props passed to components (includes middleware shared data)
  const pageProps = { params, searchParams, middlewareData };
  
  debug('Rendering page:', pattern, 'with props:', pageProps);
  
  // Helper to create elements without JSX
  const h = React.createElement;
  
  // Render page content - handle async components
  let pageContent;
  if (Page.constructor.name === 'AsyncFunction' || Page.toString().includes('async')) {
    pageContent = await Page(pageProps);
  } else {
    pageContent = h(Page, pageProps);
  }
  
  // Route-level loading boundary: wrap in Suspense so async content shows fallback
  const LoadingComponent = getMatchingLoading(url.pathname, glob);
  if (LoadingComponent) {
    const loadingFallback = h(LoadingComponent, { params, path: url.pathname });
    pageContent = h(React.Suspense, { fallback: loadingFallback }, pageContent);
  }
  
  // Route-level error boundary (Next.js error.tsx): catches render errors in this segment
  const ErrorComponent = getMatchingError(url.pathname, glob);
  if (ErrorComponent) {
    pageContent = h(RouteErrorBoundary, {
      Fallback: ErrorComponent,
      fallbackProps: { params, path: url.pathname, searchParams },
      children: pageContent,
    });
  }
  
  // Render layout
  let layoutContent;
  if (Layout.constructor.name === 'AsyncFunction' || Layout.toString().includes('async')) {
    layoutContent = await Layout({ children: pageContent });
  } else {
    layoutContent = h(Layout, null, pageContent);
  }
  
  // Single wrapper so #root has exactly one child (avoids duplicate block / "two pages" in DOM).
  const rootInner = h('div', { 'data-farm-root': 'true' }, layoutContent);
  // Build the full page. root = full document (for SSR). rootContent = single wrapper + layout (for client hydration).
  const payload = {
    root: h('html', null,
        h('head', null,
          h('meta', { charSet: 'utf-8' }),
          h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
          h('link', { rel: 'icon', href: 'data:,' }),
          metadata?.title ? h('title', null, metadata.title) : null,
          metadata?.description ? h('meta', { name: 'description', content: metadata.description }) : null
        ),
      h('body', null,
        h('div', { id: 'root' }, rootInner)
      )
    ),
    rootContent: rootInner,
`;

  // Include action results in payload if actions are enabled
  if (ctx.actionsEnabled) {
    code += `    returnValue,
    formState,
`;
  }

  code += `  };

  // Check if this is a client-side navigation request
  // Client sends Accept: text/x-component header for RSC requests
  const acceptHeader = request.headers.get('accept') || '';
  
  if (renderToReadableStream) {
    // Full RSC mode with streaming
    debug('Using RSC streaming mode');
    
    const rscStream = renderToReadableStream(payload${ctx.actionsEnabled ? ", { temporaryReferences }" : ""});
    
    if (acceptHeader.includes('text/x-component')) {
      debug('Returning RSC stream for client navigation');
      // Merge middleware headers with response headers
      const responseHeaders = new Headers(middlewareHeaders);
      responseHeaders.set('content-type', 'text/x-component');
      applyActionResponseHeaders(responseHeaders, request);
      return new Response(rscStream, { headers: responseHeaders });
    }

    // For initial page load, delegate to SSR to produce HTML
    let ssr;
    if (typeof import.meta.viteRsc?.loadModule === 'function') {
      debug('Delegating to SSR for initial HTML render');
      ssr = await import.meta.viteRsc.loadModule('ssr', 'index');
    } else if (typeof globalThis.__VITE_RSC_LOAD_SSR__ === 'function') {
      // Production serverless (e.g. Vercel): wrapper sets this before loading the handler
      debug('Delegating to SSR (runtime loader)');
      ssr = await globalThis.__VITE_RSC_LOAD_SSR__();
    }
    if (ssr) {
      // Pass payload so SSR can stream the tree (Suspense fallback first, then content)
      const html = await ssr.renderHTML({ payload, rscStream }${ctx.actionsEnabled ? ", { formState }" : ""});
      // Merge middleware headers with response headers
      const responseHeaders = new Headers(middlewareHeaders);
      responseHeaders.set('content-type', 'text/html');
      applyActionResponseHeaders(responseHeaders, request);
      return new Response(html, { headers: responseHeaders });
    }
  }
  
  // Fallback only when renderToReadableStream is not available (should not happen in RSC build)
  debug('Using fallback SSR mode (react-dom/server)');
  const pageWithScript = h('html', null,
    h('head', null,
      h('meta', { charSet: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      h('link', { rel: 'icon', href: 'data:,' }),
      metadata?.title ? h('title', null, metadata.title) : null,
      metadata?.description ? h('meta', { name: 'description', content: metadata.description }) : null,
      h('link', { rel: 'stylesheet', href: globalsCssPath, as: 'style', precedence: 'default' }),
      h('script', { type: 'module', src: '/@vite/client' })
    ),
    h('body', null,
      h('div', { id: 'root' }, layoutContent)
    )
  );
  const renderToString = (await import('react-dom/server')).renderToString;
  const html = '<!DOCTYPE html>' + renderToString(pageWithScript);
  // Merge middleware headers with response headers
  const responseHeaders = new Headers(middlewareHeaders);
  responseHeaders.set('content-type', 'text/html');
  applyActionResponseHeaders(responseHeaders, request);
  return new Response(html, { headers: responseHeaders });
  } catch (err) {
    console.error('[RSC] Handler error:', err);
    if (request.method === 'POST') {
      if (request.signal.aborted) {
        return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
      }
      return new Response('Server function failed', {
        status: 500,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }
    // If route has error.tsx, render it (Next.js-style: SSR error goes to route error boundary)
    const pathname = url.pathname.replace(/\\/$/, '') || '/';
    const ErrorComponent = getMatchingError(pathname, glob);
    if (ErrorComponent) {
      try {
        const matched = matchRoute(pathname);
        const layoutPattern = matched ? matched.pattern : null;
        const Layout = matched ? getLayout(layoutPattern) : null;
        const LayoutComp = Layout || (function PassThrough({ children }) { return children; });
        const errParams = matched ? matched.params : {};
        const errSearchParams = Object.fromEntries(url.searchParams);
        const errorElement = h(ErrorComponent, {
          error: err,
          reset: () => {},
          params: errParams,
          path: pathname,
          searchParams: errSearchParams,
        });
        const layoutContent = LayoutComp.constructor.name === 'AsyncFunction' || LayoutComp.toString().includes('async')
          ? await LayoutComp({ children: errorElement })
          : h(LayoutComp, null, errorElement);
        const rootInner = h('div', { 'data-farm-root': 'true' }, layoutContent);
        const doc = h('html', null,
          h('head', null,
            h('meta', { charSet: 'utf-8' }),
            h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
            h('link', { rel: 'icon', href: 'data:,' }),
            h('title', null, 'Error'),
            h('link', { rel: 'stylesheet', href: globalsCssPath, as: 'style', precedence: 'default' })
          ),
          h('body', null, h('div', { id: 'root' }, rootInner))
        );
        const renderToString = (await import('react-dom/server')).renderToString;
        const html = '<!DOCTYPE html>' + renderToString(doc);
        return new Response(html, { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } catch (e) {
        console.error('[RSC] Error boundary render failed:', e);
      }
    }
    const message = err && typeof err === 'object' && 'message' in err ? String(err.message) : 'Server Error';
    return new Response(JSON.stringify({ error: true, url: request.url, status: 500, message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export default { fetch: handler };

// Enable HMR - when server files change, accept the update
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;

  return code;
}
