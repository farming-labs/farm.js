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
  const routeSourceRoots = routeRoots.map((root) => {
    const routeSuffix = appSegment ? `/${appSegment}` : "";
    const sourceGlob =
      routeSuffix && root.glob.endsWith(routeSuffix)
        ? root.glob.slice(0, -routeSuffix.length)
        : root.glob;
    return { ...root, sourceGlob };
  });

  const debugLog = `// Debug disabled`;
  let code = `
import React from 'react';
import ServerErrorFallback from '/.farm/rsc-entries/error-fallback.tsx';
import { registerAPIRouteShape } from '@farm.js/core/api/runtime';
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
import {
  createFarmDeploymentCookie,
  createFarmDeploymentMismatchResponse,
  getFarmDeploymentMismatch,
} from '@farm.js/core/deployment';
import {
  _runWithMiddlewareContext,
  _runWithMiddlewareData,
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from '@farm.js/core/middleware';
import {
  getAllowedAPIRouteMethods,
  invokeAPIRouteEndpoint,
  isFarmAPIPathname,
  matchAPIRouteAtBasePath,
} from '@farm.js/core/api/runtime';
import { _runWithAfterRequest } from '@farm.js/core/after';
import { _runWithCurrentRequest, searchParamsToObject } from '@farm.js/core/internal/production-runtime';
import { getFarmRedirectError, isFarmNotFoundError } from '@farm.js/core/internal/production-runtime';
import {
  parseRoutePath,
  matchFarmPageRoute,
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from '@farm.js/core/internal/production-runtime';

const farmDeploymentId = ${JSON.stringify(ctx.deploymentId)};
const farmApiBasePath = ${JSON.stringify(ctx.apiBasePath ?? "/api")};
`;
  if (ctx.actionsEnabled) {
    code += `import {
  createServerActionRequestErrorResponse,
  getServerActionInvalidations,
  prepareServerActionRequest,
  runWithServerActionRequest,
  sanitizeServerActionError,
  validateServerActionRequest,
} from '@farm.js/core/server-action-security';

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
  // The same page URL serves HTML or Flight depending on Accept.
  const vary = (headers.get('vary') || '').split(',').map(value => value.trim().toLowerCase());
  if (!vary.includes('*') && !vary.includes('accept')) headers.append('vary', 'Accept');
  headers.set('x-farm-deployment-id', farmDeploymentId);
  const accept = request.headers.get('accept') || '';
  if (request.method === 'GET' && !accept.includes('text/x-component')) {
    headers.append('set-cookie', createFarmDeploymentCookie(
      farmDeploymentId,
      ${JSON.stringify(ctx.basePath)},
      new URL(request.url).protocol === 'https:',
    ));
  }
  if (${ctx.actionsEnabled ? "true" : "false"} && request.method === 'POST') {
    headers.set('cache-control', 'no-store');
    headers.set('x-content-type-options', 'nosniff');
  }
}

// Auto-discover all route modules. Every glob remains a literal so Vite can analyze it.
${routeSourceRoots
  .map(
    (
      root,
      index,
    ) => `const pages${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/page.{tsx,jsx,ts,js}`)}, { eager: true });
const layouts${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/layout.{tsx,jsx,ts,js}`)}, { eager: true });
const loadings${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/loading.{tsx,jsx,ts,js}`)}, { eager: true });
const errors${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/error.{tsx,jsx,ts,js}`)}, { eager: true });
const middlewares${index} = import.meta.glob(${JSON.stringify(`${root.glob}/**/middleware.{tsx,jsx,ts,js}`)}, { eager: true });
const apiRouteModules${index} = import.meta.glob(${JSON.stringify(`${root.glob}/api/**/route.{tsx,jsx,ts,js}`)}, { eager: true });
const routeDefinitionModules${index} = import.meta.glob(${JSON.stringify(
      root.sourceGlob === root.glob
        ? `${root.sourceGlob}/{farm.route,farm.routes,routes}.{tsx,jsx,ts,js}`
        : [
            `${root.sourceGlob}/{farm.route,farm.routes,routes}.{tsx,jsx,ts,js}`,
            `${root.glob}/{farm.route,farm.routes,routes}.{tsx,jsx,ts,js}`,
          ],
    )}, { eager: true });`,
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

function collectRouteModuleEntries(sources) {
  const entries = [];
  for (const [sourceIndex, source] of sources.entries()) {
    const baseValue = source.base.replace(/\\\\/g, '/').replace(/^\\.\\//, '');
    const normalizedBase = baseValue.endsWith('/') ? baseValue.slice(0, -1) : baseValue;
    for (const [filePath, module] of Object.entries(source.modules)) {
      const normalizedFile = filePath.replace(/\\\\/g, '/').replace(/^\\.\\//, '');
      const baseIndex = normalizedFile.indexOf(normalizedBase);
      let relativePath = baseIndex === -1
        ? normalizedFile
        : normalizedFile.slice(baseIndex + normalizedBase.length);
      if (!relativePath.startsWith('/')) relativePath = '/' + relativePath;
      entries.push({ sourceIndex, sourceName: source.name, filePath: normalizedFile, relativePath, module });
    }
  }
  return entries;
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
const apiRouteModules = collectRouteModuleEntries([${routeSourceRoots
    .map(
      (root, index) =>
        `{ name: ${JSON.stringify(root.name)}, base: ${JSON.stringify(root.base)}, modules: apiRouteModules${index} }`,
    )
    .join(", ")}]);
const routeDefinitionModules = collectRouteModuleEntries([${routeSourceRoots
    .map(
      (root, index) =>
        `{ name: ${JSON.stringify(root.name)}, base: ${JSON.stringify(root.sourceGlob)}, modules: routeDefinitionModules${index} }`,
    )
    .join(", ")}]);

const apiRouteMethods = ['GET', 'HEAD', 'QUERY', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const apiRouteMap = new Map();
const apiRouteShapes = new Map();

function registerApiEndpoint(routePath, filePath, method, endpoint, sourceIndex) {
  if (!routePath || typeof endpoint !== 'function') return;
  const replacedPath = registerAPIRouteShape(apiRouteShapes, routePath, filePath, sourceIndex);
  if (replacedPath) apiRouteMap.delete(replacedPath);
  const normalizedMethod = String(method || 'GET').toUpperCase();
  let route = apiRouteMap.get(routePath);
  if (!route) {
    route = { path: routePath, methods: [], handlers: {}, files: {}, sources: {} };
    apiRouteMap.set(routePath, route);
  }
  if (route.sources[normalizedMethod] === sourceIndex) {
    throw new Error(
      'Duplicate API route for ' + normalizedMethod + ' ' + routePath + ': ' +
      route.files[normalizedMethod] + ' conflicts with ' + filePath
    );
  }
  if (!route.methods.includes(normalizedMethod)) route.methods.push(normalizedMethod);
  route.handlers[normalizedMethod] = endpoint;
  route.files[normalizedMethod] = filePath;
  route.sources[normalizedMethod] = sourceIndex;
}

function getProgrammaticApiRoutes(routeModule) {
  const candidates = [routeModule?.default, routeModule?.routes, routeModule?.Route];
  for (const candidate of candidates) {
    if (candidate?.__farmRoutes === true && Array.isArray(candidate.routes)) {
      return candidate.routes.filter((route) => route?.kind === 'api');
    }
    if (candidate?.kind === 'api') return [candidate];
    if (Array.isArray(candidate)) {
      return candidate.filter((route) => route?.kind === 'api');
    }
  }
  return Object.values(routeModule || {}).filter((route) => route?.kind === 'api');
}

function registerApiRouteSources(fileModules, definitionModules, sourceCount) {
  // Process both discovery styles for each source before advancing from layers
  // to the project. A later project source therefore wins regardless of whether
  // either endpoint came from app/api/**/route or a routes definition file.
  for (let sourceIndex = 0; sourceIndex < sourceCount; sourceIndex++) {
    for (const entry of fileModules) {
      if (entry.sourceIndex !== sourceIndex) continue;
      const { filePath, relativePath, module: routeModule } = entry;
      const routePath = relativePath.replace(/\\/route\\.[tj]sx?$/i, '') || '/api';
      for (const method of apiRouteMethods) {
        if (typeof routeModule?.[method] === 'function') {
          registerApiEndpoint(routePath, filePath, method, routeModule[method], sourceIndex);
        }
      }
    }

    for (const entry of definitionModules) {
      if (entry.sourceIndex !== sourceIndex) continue;
      const { filePath, module: routeModule } = entry;
      for (const endpoint of Object.values(routeModule)) {
        if (typeof endpoint === 'function' && endpoint.__path) {
          registerApiEndpoint(endpoint.__path, filePath, endpoint.__method || 'GET', endpoint, sourceIndex);
        }
      }

      for (const route of getProgrammaticApiRoutes(routeModule)) {
        for (const [method, endpoint] of Object.entries(route.methods || {})) {
          registerApiEndpoint(route.path, filePath, method, endpoint, sourceIndex);
        }
      }
    }
  }
}

registerApiRouteSources(apiRouteModules, routeDefinitionModules, ${routeSourceRoots.length});

async function handleAPIRequest(request) {
  const url = new URL(request.url);
  const match = matchAPIRouteAtBasePath(apiRouteMap, url.pathname, farmApiBasePath);
  if (!match) return null;

  const method = request.method.toUpperCase();
  const endpoint = match.route.handlers[method] ??
    (method === 'HEAD' ? match.route.handlers.GET : undefined);
  if (!endpoint) {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: {
        'Allow': getAllowedAPIRouteMethods(match.route).join(', '),
        'Content-Type': 'application/json',
      },
    });
  }

  try {
    return await invokeAPIRouteEndpoint(endpoint, request, match.params);
  } catch (error) {
    console.error('[API Error] ' + url.pathname + ':', error);
    return new Response(JSON.stringify({
      error: 'Internal Server Error',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
const farmMiddlewareRunner = createProductionMiddlewareRunner({
  modules: Object.entries(middlewares).map(([filePath, module]) => ({
    path: middlewarePathToRoute(filePath),
    filePath,
    module,
  })),
});

debug('Discovered pages:', Object.keys(pages));
debug('Discovered layouts:', Object.keys(layouts));
debug('Discovered loadings:', Object.keys(loadings));
debug('Discovered errors:', Object.keys(errors));
debug('Discovered middlewares:', Object.keys(middlewares));
debug('Discovered API routes:', Array.from(apiRouteMap.keys()));

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
 * Execute middleware chain for a request
 */
async function executeMiddleware(request) {
  return farmMiddlewareRunner(request);
}

/**
 * Convert file path to route pattern
 * e.g., '/src/about/page.tsx' -> '/about'
 * e.g., '/blog/[slug]/page.tsx' -> '/blog/[slug]'
 */
function filePathToRoute(filePath) {
  let route = filePath
    .replace('', '')
    .replace(/\\/page\\.[tj]sx?$/, '')
    .replace(/\\/page$/, '') || '/';
  
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

// Parse and rank once per entry initialization, not on every request. Use the
// same validation, decoding and specificity rules as Farm's ordinary router.
const pageRoutes = Object.entries(pages).map(([filePath, module]) => ({
  filePath,
  module,
  segments: parseRoutePath(filePath).segments,
  specificity: getRoutePatternSpecificity(filePathToRoute(filePath)),
})).sort((left, right) => compareRouteSpecificity(left.specificity, right.specificity));

/**
 * Simple file-based router
 * Converts URL pathname to matching page component
 */
function matchRoute(pathname) {
  const normalized = pathname.replace(/\\/$/, '') || '/';
  
  for (const { filePath, module, segments } of pageRoutes) {
    const match = matchFarmPageRoute(normalized, segments);
    
    if (match.matches) {
      debug('Matched route:', filePath, 'for path:', normalized);
      return {
        Page: module.default,
        pattern: filePath,
        params: match.params,
        pageMetadata: module.metadata,
      };
    }
  }
  
  debug('No route matched for:', normalized);
  return null;
}

function mergeDocumentMetadata(...sources) {
  const metadata = {};
  for (const source of sources) {
    if (typeof source?.title === 'string') metadata.title = source.title;
    if (typeof source?.description === 'string') metadata.description = source.description;
  }
  return metadata;
}

/**
 * Find every applicable layout module from root to the page directory.
 * Rendering and document metadata share the complete root -> nested layouts
 * -> page chain.
 */
function getLayoutModules(pageFilePath) {
  const tryKeys = (...keys) => {
    for (const k of keys) {
      if (layouts[k]?.default) return layouts[k];
    }
    return null;
  };
  const dir = pageFilePath.replace(/\\/page\\.[tj]sx?$/i, '');
  const extensions = ['tsx', 'jsx', 'ts', 'js'];
  const parts = dir.split('/').filter(Boolean);
  const matches = [];

  for (let depth = 0; depth <= parts.length; depth++) {
    const relativeDir = parts.slice(0, depth).join('/');
    const absoluteDir = relativeDir ? '/' + relativeDir : '';
    let matchedLayout = null;
    for (const ext of extensions) {
      matchedLayout = tryKeys(
        absoluteDir + '/layout.' + ext,
        relativeDir ? relativeDir + '/layout.' + ext : 'layout.' + ext,
      );
      if (matchedLayout) break;
    }
    if (matchedLayout) matches.push(matchedLayout);
  }

  return matches;
}

/**
 * Main request handler - entry point for both dev and production (Nitro).
 * Exported as { fetch: handler } for the RSC/Nitro contract (see vite-plugin-rsc-deploy-example).
 */
async function handleFarmRequest(request) {
  let url = new URL(request.url);
  let errorData = new Map();
  let errorContext = new Map();
  let errorHeaders = new Headers();
  try {
  debug('Handling request:', request.method, url.pathname);

  const deploymentMismatch = getFarmDeploymentMismatch(request, farmDeploymentId);
  if (deploymentMismatch) {
    return createFarmDeploymentMismatchResponse(deploymentMismatch);
  }

  const initialApiMatch = matchAPIRouteAtBasePath(apiRouteMap, url.pathname, farmApiBasePath);
  const isInitialApiRequest = Boolean(initialApiMatch) ||
    isFarmAPIPathname(url.pathname, farmApiBasePath) || isFarmAPIPathname(url.pathname);

  ${
    ctx.actionsEnabled
      ? `if (request.method === 'POST' && !isInitialApiRequest) {
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
  const middlewareResult = await executeMiddleware(request);
  
  // If middleware handled the request (e.g., redirect, auth), return the response
  if (middlewareResult.response) {
    return middlewareResult.response;
  }

  request = middlewareResult.request;
  url = new URL(request.url);

  // Extract middleware data and headers for page rendering
  const middlewareData = Object.fromEntries(middlewareResult.data);
  const middlewareContext = middlewareResult.context;
  const middlewareHeaders = new Headers(middlewareResult.headers);
  errorData = middlewareResult.data;
  errorContext = middlewareContext;
  errorHeaders = middlewareHeaders;
  if (middlewareResult.data.size || middlewareContext.size) {
    middlewareHeaders.set('cache-control', 'private, no-store');
  }

  // A rewrite replaces the Request. Re-enter request context so downstream
  // APIs and server components observe the rewritten URL.
  return await _runWithCurrentRequest(request, () =>
    _runWithMiddlewareData(middlewareResult.data, () =>
      _runWithMiddlewareContext(middlewareContext, async () => {
  const glob = '';

  const apiResponse = await handleAPIRequest(request.clone());
  if (apiResponse) {
    return applyProductionMiddlewareHeaders(apiResponse, middlewareHeaders);
  }
  if (isFarmAPIPathname(url.pathname, farmApiBasePath) || isFarmAPIPathname(url.pathname)) {
    return applyProductionMiddlewareHeaders(new Response(
      JSON.stringify({ error: 'API route not found', pathname: url.pathname }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ), middlewareHeaders);
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
        const result = await runWithServerActionRequest(request, async () => {
          const data = await action.apply(null, args);
          return { data, invalidations: getServerActionInvalidations() };
        });
        returnValue = { ok: true, data: result.data, invalidations: result.invalidations };
        debug('Server action succeeded:', actionId);
      } catch (e) {
        if (request.signal.aborted) {
          return new Response(null, { status: 499, headers: { 'Cache-Control': 'no-store' } });
        }
        const actionError = sanitizeServerActionError(e);
        if (actionError.name === 'ServerActionError') {
          console.error('[Farm.js] Server action failed:', e);
        }
        returnValue = { ok: false, data: actionError };
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
        const actionError = sanitizeServerActionError(e);
        if (actionError.name === 'ServerActionError') {
          console.error('[Farm.js] Form action failed:', e);
        }
        debug('Form action failed:', actionError);
        return new Response(actionError.message, {
          status: actionError.name === 'ServerFnFailure' ? actionError.status : 500,
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
  
  const { Page, pattern, params, pageMetadata } = matched;
  const LayoutModules = getLayoutModules(pattern);
  const metadata = mergeDocumentMetadata(
    ...LayoutModules.map((layoutModule) => layoutModule.metadata),
    pageMetadata,
  );
  const configuredRoutesDir = ${ctx.routesDir === undefined ? "undefined" : JSON.stringify(ctx.routesDir)};
  const routesDir = configuredRoutesDir === undefined ? 'app' : configuredRoutesDir.trim();
  const routesPath = routesDir ? '/' + routesDir : '';
  const globalsCssPath = '/${ctx.srcDir}' + routesPath + '/globals.css';
  
  // Parse search params
  // Collect repeated keys into arrays, matching the searchParams prop shape
  // every non-RSC environment produces (see core's search-params.ts).
  const searchParams = searchParamsToObject(url.searchParams);
  
  // Page props passed to components (includes middleware shared data)
  const pageProps = { params, searchParams, middlewareData };
  
  debug('Rendering page:', pattern, 'with props:', pageProps);
  
  // Helper to create elements without JSX
  const h = React.createElement;
  
  // Render page content - only native async functions need direct awaiting.
  // Synchronous components must retain React's hook dispatcher. Source text
  // containing the word async does not change how a component executes.
  let pageContent;
  if (Page.constructor.name === 'AsyncFunction') {
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
  
  // Render layouts inside out so every ancestor wraps its descendants.
  let layoutContent = pageContent;
  for (let index = LayoutModules.length - 1; index >= 0; index--) {
    const Layout = LayoutModules[index].default;
    const layoutProps = { params: pageProps.params, children: layoutContent };
    if (Layout.constructor.name === 'AsyncFunction') {
      layoutContent = await Layout(layoutProps);
    } else {
      layoutContent = h(Layout, layoutProps);
    }
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
    metadata: {
      title: typeof metadata?.title === 'string' ? metadata.title : undefined,
      description: typeof metadata?.description === 'string' ? metadata.description : undefined,
    },
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
      })
    )
  );
  } catch (err) {
    const redirect = getFarmRedirectError(err);
    if (redirect) return new Response(null, { status: redirect.status, headers: { location: redirect.url, 'cache-control': 'no-store' } });
    if (isFarmNotFoundError(err)) return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
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
    // Render outside the failed page/layout tree, but retain request context.
    const pathname = url.pathname.replace(/\\/$/, '') || '/';
    const ErrorComponent = getMatchingError(pathname, '');
    if (ErrorComponent) {
      try {
        return await _runWithCurrentRequest(request, () =>
          _runWithMiddlewareData(errorData, () =>
            _runWithMiddlewareContext(errorContext, async () => {
              const h = React.createElement;
              const matched = matchRoute(pathname);
              const errSearchParams = searchParamsToObject(url.searchParams);
              const fallbackProps = {
                params: matched?.params || {},
                path: pathname,
                search: url.search,
                searchParams: errSearchParams,
                middlewareData: Object.fromEntries(errorData),
              };
              // Preserve the original failure in logs, not production payloads.
              const message = ${ctx.development === true ? "true" : "false"} && err instanceof Error
                ? err.message : 'Internal Server Error';
              const isClientBoundary = ErrorComponent.$$typeof === Symbol.for('react.client.reference');
              const errorElement = isClientBoundary
                ? h(ServerErrorFallback, { Fallback: ErrorComponent, message, fallbackProps })
                : h(ErrorComponent, { ...fallbackProps, error: new Error(message), reset: () => {} });
              const rootInner = h('div', { 'data-farm-root': 'true' }, errorElement);
              const payload = {
                root: h('html', null,
                  h('head', null, h('meta', { charSet: 'utf-8' }), h('title', null, 'Error')),
                  h('body', null, h('div', { id: 'root' }, rootInner))),
                rootContent: rootInner,
                metadata: { title: 'Error' },
              };
              const rscStream = renderToReadableStream(payload);
              const headers = new Headers(errorHeaders);
              headers.set('cache-control', 'private, no-store');
              headers.set('x-content-type-options', 'nosniff');
              applyActionResponseHeaders(headers, request);
              if ((request.headers.get('accept') || '').includes('text/x-component')) {
                headers.set('content-type', 'text/x-component');
                return new Response(rscStream, { status: 500, headers });
              }
              let ssr;
              if (typeof import.meta.viteRsc?.loadModule === 'function') {
                ssr = await import.meta.viteRsc.loadModule('ssr', 'index');
              } else if (typeof globalThis.__VITE_RSC_LOAD_SSR__ === 'function') {
                ssr = await globalThis.__VITE_RSC_LOAD_SSR__();
              }
              if (!ssr) {
                void rscStream.cancel().catch(() => {});
                throw new Error('SSR environment unavailable');
              }
              const html = await ssr.renderHTML({ payload, rscStream });
              headers.set('content-type', 'text/html; charset=utf-8');
              return new Response(html, { status: 500, headers });
            })
          )
        );
      } catch (fallbackError) {
        console.error('[RSC] Error boundary render failed:', fallbackError);
      }
    }
    const message = 'Internal Server Error';
    return new Response(JSON.stringify({ error: true, url: request.url, status: 500, message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
    });
  }
}

async function handler(request, context) {
  return _runWithCurrentRequest(request, () =>
    _runWithAfterRequest(request, () => handleFarmRequest(request), context)
  );
}

export default { fetch: handler };

// Enable HMR - when server files change, accept the update
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;

  return code;
}
