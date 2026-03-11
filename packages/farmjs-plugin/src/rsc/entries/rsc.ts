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
  const appSegment = (ctx.routesDir?.trim() ?? "") || "app";
  const glob = `/${ctx.srcDir}/${appSegment}`;

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

  // Auto-discover pages, layouts, and middleware using Vite's glob import
  code += `
// Debug logging helper
function debug(...args) {
  ${debugLog}
}

// Auto-discover all page, layout, and middleware files
// eager: true means they're imported at startup, not lazily
const pages = import.meta.glob('${glob}/**/page.{tsx,jsx,ts,js}', { eager: true });
const layouts = import.meta.glob('${glob}/**/layout.{tsx,jsx,ts,js}', { eager: true });
const middlewares = import.meta.glob('${glob}/**/middleware.{tsx,jsx,ts,js}', { eager: true });

debug('Discovered pages:', Object.keys(pages));
debug('Discovered layouts:', Object.keys(layouts));
debug('Discovered middlewares:', Object.keys(middlewares));

/**
 * Convert middleware file path to route path
 * e.g., '/src/middleware.ts' -> '/'
 * e.g., '/src/counter/middleware.ts' -> '/counter'
 */
function middlewarePathToRoute(filePath) {
  let route = filePath
    .replace('${glob}', '')
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
    .replace('${glob}', '')
    .replace(/\\/page\\.[tj]sx?$/, '')
    .replace(/\\/page$/, '') || '/';
  
  // Convert [param] to :param for matching
  route = route.replace(/\\[([^\\]]+)\\]/g, ':$1');
  
  return route;
}

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
 * Layout keys from glob are like '/src/layout.tsx' or 'src/about/layout.tsx'.
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

  // Root layout (glob is e.g. '/src')
  for (const ext of extensions) {
    const layout = tryKeys('${glob}/layout.' + ext, '${glob}'.replace(/^\\//, '') + '/layout.' + ext);
    if (layout) return layout;
  }
  return null;
}

/**
 * Main request handler - entry point for both dev and production (Nitro).
 * Exported as { fetch: handler } for the RSC/Nitro contract (see vite-plugin-rsc-deploy-example).
 */
async function handler(request) {
  try {
  const url = new URL(request.url);
  debug('Handling request:', request.method, url.pathname);

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
`;

  // If actions enabled, add action handling before rendering
  if (ctx.actionsEnabled) {
    code += `
  // Variables to hold action results
  let returnValue, formState, temporaryReferences;

  // Handle POST requests (server actions)
  if (request.method === 'POST') {
    const actionId = request.headers.get('x-farm-action-id');
    
    if (actionId) {
      // Action called via JavaScript (after hydration)
      debug('Executing server action:', actionId);
      temporaryReferences = createTemporaryReferenceSet();
      try {
        const contentType = request.headers.get('content-type') || '';
        const body = contentType.includes('multipart/form-data')
          ? await request.formData()
          : await request.text();
        const args = await decodeReply(body, { temporaryReferences });
        const action = await loadServerAction(actionId);
        const data = await action.apply(null, args);
        returnValue = { ok: true, data };
        debug('Server action succeeded:', actionId);
      } catch (e) {
        returnValue = { ok: false, data: e };
        debug('Server action failed:', actionId, e);
      }
    } else {
      // Progressive enhancement (form submitted before JS loaded)
      debug('Handling progressive enhancement form submission');
      
      const formData = await request.formData();
      const decoded = await decodeAction(formData);
      
      try {
        const result = await decoded();
        formState = await decodeFormState(result, formData);
      } catch (e) {
        debug('Form action failed:', e);
        return new Response('Action Failed', { status: 500 });
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
  const routesDir = ${JSON.stringify(ctx.routesDir ?? "")}.trim();
  const routesPath = routesDir ? '/' + routesDir : '/app';
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
        metadata?.title ? h('title', null, metadata.title) : null,
        metadata?.description ? h('meta', { name: 'description', content: metadata.description }) : null,
        typeof import.meta.viteRsc?.loadCss === 'function' ? import.meta.viteRsc.loadCss() : h('link', { rel: 'stylesheet', href: globalsCssPath })
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
      const html = await ssr.renderHTML(rscStream${ctx.actionsEnabled ? ", { formState }" : ""});
      // Merge middleware headers with response headers
      const responseHeaders = new Headers(middlewareHeaders);
      responseHeaders.set('content-type', 'text/html');
      return new Response(html, { headers: responseHeaders });
    }
  }
  
  // Fallback only when renderToReadableStream is not available (should not happen in RSC build)
  debug('Using fallback SSR mode (react-dom/server)');
  const pageWithScript = h('html', null,
    h('head', null,
      h('meta', { charSet: 'utf-8' }),
      h('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
      metadata?.title ? h('title', null, metadata.title) : null,
      metadata?.description ? h('meta', { name: 'description', content: metadata.description }) : null,
      h('link', { rel: 'stylesheet', href: globalsCssPath }),
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
  return new Response(html, { headers: responseHeaders });
  } catch (err) {
    console.error('[RSC] Handler error:', err);
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
