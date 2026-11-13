import { createRequire } from "node:module";
import type { EntryContext } from "../types.js";
import {
  FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER,
  FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER,
} from "../mobile-client.js";

const require_ = createRequire(import.meta.url);

/** Core's production source for the \`mcp\` plugin, so both servers merge config the same way. */
function generateMCPPluginSource(): { importSource: string; registerSource: string } {
  const { generateNativeMCPPluginSource } = require_(
    "@farm.js/core/internal/production-runtime",
  ) as typeof import("@farm.js/core/internal/production-runtime");
  return generateNativeMCPPluginSource({ enabled: true });
}

/**
 * Generates the terminal middleware-result handling shared by the RSC entry
 * and its executable contract tests.
 */
export function generateRscMiddlewareResultHandling(): string {
  return `
  // If middleware handled the request (e.g., redirect, auth), return the response
  if (middlewareResult.response) {
    return middlewareResult.response;
  }
  // notFound() in middleware stops the request before any route runs. It gets
  // the same 404 as a page-level notFound(), plus headers middleware set.
  if (middlewareResult.notFound) {
    return applyProductionMiddlewareHeaders(
      new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } }),
      middlewareResult.headers,
    );
  }
`;
}

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
  // A root-mounted app without i18n matches pages on the path as received, with no extra work.
  const hasBasePath = !["", "/"].includes(ctx.basePath.trim());
  const routesBelowPrefix = hasBasePath || ctx.i18n?.enabled === true;
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
  const middlewareConfigImports = (ctx.middlewareConfigPaths ?? [])
    .map(
      (configPath, index) =>
        `import * as FarmMiddlewareConfigModule${index} from ${JSON.stringify(
          configPath.replace(/\\/g, "/"),
        )};`,
    )
    .join("\n");
  const mcpConfigImports = (ctx.mcpConfigPaths ?? [])
    .map(
      (configPath, index) =>
        `import * as FarmMCPConfigModule${index} from ${JSON.stringify(
          configPath.replace(/\\/g, "/"),
        )};`,
    )
    .join("\n");
  // Imported for their factories, which register what a plugin's server functions use.
  const pluginsConfigImports = (ctx.pluginsConfigPaths ?? [])
    .map((configPath) => `import ${JSON.stringify(configPath.replace(/\\/g, "/"))};`)
    .join("\n");
  const mcpSource = ctx.mcpConfigPaths?.length ? generateMCPPluginSource() : null;
  const middlewareConfigValues = (ctx.middlewareConfigPaths ?? []).map(
    (_configPath, index) =>
      `(FarmMiddlewareConfigModule${index}.default || FarmMiddlewareConfigModule${index})`,
  );
  let code = `
import React from 'react';
import ServerErrorFallback from '/.farm/rsc-entries/error-fallback.tsx';
${middlewareConfigImports}
${mcpConfigImports}
${pluginsConfigImports}
${mcpSource ? `${mcpSource.importSource}\nimport { mergePluginAPIRoutes } from '@farm.js/core/api/runtime';` : ""}
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
import { _withFarmGuardedResponseCache } from '@farm.js/core/internal/production-runtime';
${ctx.mobileClient === "entry" ? "import { _applyFarmMobileShellClient, createFarmNativeTreeResponse, resolveFarmWebRequestOrigin } from '@farm.js/core/internal/production-runtime';\n" : ctx.mobileClient === "inline" ? "import { createFarmNativeTreeResponse, resolveFarmWebRequestOrigin } from '@farm.js/core/internal/production-runtime';\n" : ""}import {
  getAllowedAPIRouteMethods,
  invokeAPIRouteEndpoint,
  isFarmAPIPathname,
  matchAPIRouteAtBasePath,
} from '@farm.js/core/api/runtime';
import { _runWithAfterRequest } from '@farm.js/core/after';
import { _runWithAPIRequestRuntime, _runWithCurrentRequest, cloneFarmRequestWithContext, searchParamsToObject } from '@farm.js/core/internal/production-runtime';
import { getFarmRedirectError, isFarmNotFoundError } from '@farm.js/core/internal/production-runtime';
import {
  parseRoutePath,
  matchFarmPageRoute,
  compareRouteSpecificity,
  getRoutePatternSpecificity,
} from '@farm.js/core/internal/production-runtime';
import {
  appMiddlewareMayHandlePath,
  configMiddlewareMayHandlePath,
  materializeSSGRoutePath,
  mergeMetadata,
  mergeModuleViewport,
  mergeRouteRenderingDirectiveConfig,
  renderMetadataHead,
  resolveMetadataTitle,
} from '@farm.js/core/internal/production-runtime';

import {
  FARM_MARKDOWN_CONTENT_TYPE,
  applyMarkdownNegotiationHeaders,
  createFarmMarkdownErrorBody,
  createMarkdownMirrorResponse,
  farmRequestWantsMarkdown,
} from '@farm.js/core/markdown';
${
  ctx.markdown?.enabled
    ? `import { getFarmMarkdownAlternatePath } from '@farm.js/core/markdown';
import { addMetadataMarkdownAlternate } from '@farm.js/core/internal/production-runtime';
`
    : ""
}import { stripFarmBasePath, stripFarmLocaleFromPathname } from '@farm.js/core/internal/production-runtime';
import { resolveFarmTrailingSlashRedirect } from '@farm.js/core/internal/production-runtime';
${
  ctx.trailingSlash
    ? `import { normalizeFarmTrailingSlashPathname, setFarmTrailingSlashPreference } from '@farm.js/core/internal/production-runtime';

// trailingSlash: <Link href="/about"> renders /about/, as in core's renderers. Client components
// render in the SSR environment, which shares this process; the browser entry sets it too.
setFarmTrailingSlashPreference(true);
`
    : ""
}
${
  hasBasePath
    ? `import { applyFarmBasePath, setFarmBasePath } from '@farm.js/core/internal/production-runtime';

// <Link href="/about"> renders /console/about, as in core's renderers. Client components render in
// the SSR environment, which shares this process; the browser entry sets it for hydration.
setFarmBasePath(${JSON.stringify(ctx.basePath)});
`
    : ""
}
${
  ctx.images && ctx.images.runtime !== "none"
    ? `import { createCloudflareImageTransformer, createFarmImageHandler } from '@farm.js/core/image/server';
${
  ctx.images.runtime === "node"
    ? "import { createNodeImageFetcher, createNodeImageUrlValidator, createSharpImageTransformer } from '@farm.js/core/image/sharp';"
    : ""
}
const farmImageConfig = ${JSON.stringify(ctx.images.config)};
const farmImageHandler = createFarmImageHandler(farmImageConfig, ${
        ctx.images.runtime === "cloudflare"
          ? `{
  transform: createCloudflareImageTransformer(),
  onError(error) { console.error('[Farm Image]', error); },
}`
          : `{
  transform: createSharpImageTransformer(),
  fetchRemote: createNodeImageFetcher(farmImageConfig),
  validateRemoteUrl: createNodeImageUrlValidator(farmImageConfig),
  onError(error) { console.error('[Farm Image]', error); },
}`
      });`
    : "const farmImageHandler = null;"
}
const farmImagePath = ${JSON.stringify(ctx.images?.path ?? "/_farm/image")};
${
  ctx.images
    ? `// <Image> reads this when @farm.js/core/image is not bundled (dev, or an external dependency),
// where the __FARM_IMAGE_CONFIG__ define never reaches it. The SSR environment shares the process.
globalThis.__FARM_IMAGE_CONFIG__ = ${JSON.stringify(ctx.images.public)};`
    : ""
}
const farmDeploymentId = ${JSON.stringify(ctx.deploymentId)};
const farmApiBasePath = ${JSON.stringify(ctx.apiBasePath ?? "/api")};
const farmMarkdownConfig = ${JSON.stringify(ctx.markdown ?? { enabled: false, expose: [], cache: false, includeMetadata: true })};
const farmRouteI18n = ${JSON.stringify(ctx.i18n ?? { enabled: false, basePath: ctx.basePath })};

/**
 * A request path without the app's basePath and locale prefix, as core's servers and the
 * middleware runner read it: '/console/fr/about' is '/about'. Pages match it (matchRoute), and
 * Markdown names a home page '<prefix>/index.md' and matches md.expose on it.
 */
function getFarmRoutePathname(pathname) {
  return farmRouteI18n.enabled
    ? stripFarmLocaleFromPathname(pathname, farmRouteI18n)
    : stripFarmBasePath(pathname, farmRouteI18n.basePath);
}
`;
  // The generated agent files list the app's static pages.
  const listsAgentPages = ctx.llmsTxt?.enabled === true || ctx.sitemap?.enabled === true;
  if (listsAgentPages) {
    code += `import {
  createFarmMetadataRouteResponse,
  farmPathGuardCoversPage,
  isFarmPageNoIndex,
  resolveFarmAgentOrigin,
} from '@farm.js/core/internal/production-runtime';
`;
  }
  if (ctx.llmsTxt?.enabled) {
    code += `import {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
  createFarmLlmsFullRenderer,
  createFarmLlmsMarkdownReader,
  renderFarmLlmsFullTxt,
} from '@farm.js/core/internal/production-runtime';
import { FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS } from '@farm.js/core/internal/app-markdown-runtime';

const farmLlmsTxtConfig = ${JSON.stringify(ctx.llmsTxt)};
const farmLlmsFullRenderer = createFarmLlmsFullRenderer({ revalidate: farmLlmsTxtConfig.revalidate });
`;
  }
  if (ctx.sitemap?.enabled) {
    code += `import { createFarmDefaultSitemap } from '@farm.js/core/internal/production-runtime';

const farmAgentSitemapConfig = ${JSON.stringify(ctx.sitemap)};
// Each page file's last change, read by the build (by farm dev when it starts).
const farmPageLastModified = ${JSON.stringify(ctx.pageLastModified ?? {})};
`;
  }
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

  // In development, a page, layout, loading or error file that fails to load
  // fails only the routes that use it. Eager globs would fail the whole entry,
  // so every route returned the same error until the file was fixed. The
  // modules still load once, in order, before the first request. Middleware
  // and API routes stay eager: skipping a broken auth middleware would leave
  // its routes unprotected. Production keeps eager globs, where a broken
  // import already fails the build.
  const isolateRouteModules = ctx.development === true;
  const uiRouteGlob = (pattern: string) =>
    isolateRouteModules
      ? `await loadFarmDevRouteModules(import.meta.glob(${JSON.stringify(pattern)}))`
      : `import.meta.glob(${JSON.stringify(pattern)}, { eager: true })`;
  if (isolateRouteModules) {
    code += `
const farmRouteLoadErrors = new Map();

async function loadFarmDevRouteModules(loaders) {
  const modules = {};
  for (const [filePath, load] of Object.entries(loaders)) {
    try {
      modules[filePath] = await load();
    } catch (error) {
      console.error('[Farm.js] Could not load ' + filePath + ':', error);
      const failed = {
        default: function FarmRouteLoadFailure() {
          throw error;
        },
      };
      farmRouteLoadErrors.set(failed, error);
      modules[filePath] = failed;
    }
  }
  return modules;
}

/** The load error of a module the matched route renders with, if any. */
function findFarmRouteLoadError(matched) {
  if (farmRouteLoadErrors.size === 0) return undefined;
  const routeModules = [
    pages[matched.pattern],
    ...getRouteModules(matched.pattern, layouts, 'layout'),
    ...getRouteModules(matched.pattern, loadings, 'loading'),
    ...getRouteModules(matched.pattern, errors, 'error'),
  ];
  for (const module of routeModules) {
    if (farmRouteLoadErrors.has(module)) return farmRouteLoadErrors.get(module);
  }
  return undefined;
}
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
  // A page renders per request (cookies, headers, client address), so a shared
  // cache must not keep its HTML or Flight payload unless middleware chose a
  // policy. Core's server defaults pages the same way.
  if (!headers.has('cache-control')) headers.set('cache-control', 'private, no-store');
}

// Auto-discover all route modules. Every glob remains a literal so Vite can analyze it.
${routeSourceRoots
  .map(
    (root, index) => `const pages${index} = ${uiRouteGlob(`${root.glob}/**/page.{tsx,jsx,ts,js}`)};
const layouts${index} = ${uiRouteGlob(`${root.glob}/**/layout.{tsx,jsx,ts,js}`)};
const loadings${index} = ${uiRouteGlob(`${root.glob}/**/loading.{tsx,jsx,ts,js}`)};
const errors${index} = ${uiRouteGlob(`${root.glob}/**/error.{tsx,jsx,ts,js}`)};
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
// Root layouts that render <html> themselves own the document, as in Next.js.
const farmDocumentLayoutKeys = new Set(${JSON.stringify(ctx.documentLayouts ?? [])});
const farmDocumentLayoutModules = new Set(
  Object.entries(layouts)
    .filter(([key]) => farmDocumentLayoutKeys.has(key))
    .map(([, module]) => module),
);

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
${
  mcpSource
    ? `
// mcp: the same plugin core's production server mounts, built from the mcp
// config read from each config file, layers first.
const farmNativeMCPPlugin = (() => {
  const farmRuntimeConfigs = [${(ctx.mcpConfigPaths ?? [])
    .map((_path, index) => `(FarmMCPConfigModule${index}.default || FarmMCPConfigModule${index})`)
    .join(", ")}];
  ${mcpSource.registerSource}
  return farmNativeMCPPlugin;
})();
if (farmNativeMCPPlugin) {
  const mountedRoutes = [...apiRouteMap.values()].map((route) => ({
    path: route.path,
    methods: [...route.methods],
    endpoints: { ...route.handlers },
  }));
  // Rejects a plugin route that would replace an app endpoint. An MCP tool calls its
  // endpoint through handler(), so the middleware guarding that path runs for it.
  for (const route of mergePluginAPIRoutes(mountedRoutes, [farmNativeMCPPlugin], undefined, {
    dispatch: (request) => handler(request),
  })) {
    for (const method of route.pluginMethods ?? []) {
      let target = apiRouteMap.get(route.path);
      if (!target) {
        target = { path: route.path, methods: [], handlers: {}, files: {}, sources: {} };
        apiRouteMap.set(route.path, target);
      }
      target.methods.push(method);
      target.handlers[method] = route.endpoints[method];
      target.files[method] = 'plugin:' + farmNativeMCPPlugin.name;
    }
  }
}
`
    : ""
}
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
const farmRuntimeConfigs = [${middlewareConfigValues.join(", ")}].filter(Boolean);
const farmConfigMiddleware = farmRuntimeConfigs.flatMap((config) => {
  const middleware = config.middleware;
  if (!middleware) return [];
  return Array.isArray(middleware) ? middleware : [middleware];
});
const farmMiddlewareRunner = createProductionMiddlewareRunner({
  config: farmConfigMiddleware,
  modules: Object.entries(middlewares)
    .map(([filePath, module]) => ({
      path: middlewarePathToRoute(filePath),
      filePath,
      module,
    }))
    .filter((entry) => entry.path !== null)
    // Root first, as core runs them: a nested guard can rely on what its
    // parent middleware set, and glob order is alphabetical, not by depth.
    // Route groups share a URL path; the shallower file runs first, so
    // '/middleware.ts' precedes '/(app)/middleware.ts'.
    .sort(
      (left, right) =>
        middlewareRouteDepth(left.path) - middlewareRouteDepth(right.path) ||
        left.path.localeCompare(right.path) ||
        middlewareRouteDepth(left.filePath) - middlewareRouteDepth(right.filePath) ||
        left.filePath.localeCompare(right.filePath),
    ),
  i18n: ${JSON.stringify(ctx.i18n) ?? "undefined"},
  server: ${JSON.stringify(ctx.server) ?? "undefined"},
  apiBasePath: farmApiBasePath,
  // matchRoute() can select a page by the path as received (a page under app/<basePath>/ or
  // app/[lang]/) as well as by the route path, so middleware guards both.
  rawPathRouting: true,
});

debug('Discovered pages:', Object.keys(pages));
debug('Discovered layouts:', Object.keys(layouts));
debug('Discovered loadings:', Object.keys(loadings));
debug('Discovered errors:', Object.keys(errors));
debug('Discovered middlewares:', Object.keys(middlewares));
debug('Discovered API routes:', Array.from(apiRouteMap.keys()));

/**
 * Convert an app-relative middleware file path to the route it guards, with the
 * same rules as core's middleware discovery: a route group such as
 * '(protected)' or a parallel route slot such as '@team' adds no URL segment,
 * an intercepting folder guards the URL it intercepts, a '_private' folder
 * routes its pages so its middleware guards them, and a dot-prefixed folder
 * holds no routes, so its middleware never runs (null).
 * e.g., '/middleware.ts' -> '/'
 * e.g., '/(protected)/dashboard/middleware.ts' -> '/dashboard'
 * e.g., '/dashboard/@team/middleware.ts' -> '/dashboard'
 * e.g., '/feed/@modal/(.)photo/middleware.ts' -> '/feed/photo'
 */
function middlewarePathToRoute(filePath) {
  const segments = filePath
    .replace(/\\/middleware\\.[tj]sx?$/, '')
    .split('/')
    .filter(Boolean);
  if (segments.some((segment) => segment.startsWith('.'))) {
    return null;
  }
  const routeSegments = [];
  for (const segment of segments) {
    const marker = /^((?:\\(\\.\\.\\))+|\\(\\.\\.\\.\\)|\\(\\.\\))(.*)$/.exec(segment);
    if (marker) {
      if (marker[1] === '(...)') routeSegments.length = 0;
      else if (marker[1] !== '(.)') routeSegments.splice(-(marker[1].length / 4));
      if (marker[2]) routeSegments.push(marker[2]);
      continue;
    }
    if ((segment.startsWith('(') && segment.endsWith(')')) || /^@[A-Za-z][A-Za-z0-9_-]*$/.test(segment)) {
      continue;
    }
    routeSegments.push(segment);
  }
  return routeSegments.length === 0 ? '/' : '/' + routeSegments.join('/');
}

function middlewareRouteDepth(route) {
  return route === '/' ? 0 : route.split('/').length - 1;
}

/**
 * Execute middleware chain for a request
 */
async function executeMiddleware(request, context) {
  // The Request was rebuilt by the Nitro handler and has no socket; the
  // handler passes the connection's address alongside it.
  return farmMiddlewareRunner(request, { clientAddress: context?.clientAddress });
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
// RSC renders no parallel route slots, so a page inside '@modal/...' would otherwise
// answer at its literal folder path ('/feed/@modal/(.)photo/1'), past the middleware
// that guards the URL it intercepts.
const pageRoutes = Object.entries(pages)
  .filter(([filePath]) => !filePath.split('/').some((segment) => /^@[A-Za-z][A-Za-z0-9_-]*$/.test(segment)))
  .map(([filePath, module]) => ({
  filePath,
  module,
  segments: parseRoutePath(filePath).segments,
  specificity: getRoutePatternSpecificity(filePathToRoute(filePath)),
})).sort((left, right) => compareRouteSpecificity(left.specificity, right.specificity));

/**
 * Simple file-based router
 * Converts URL pathname to matching page component
 */
${
  routesBelowPrefix
    ? `function matchRoute(pathname) {
  const normalized = pathname.replace(/\\/$/, '') || '/';
  const routePathname = getFarmRoutePathname(normalized);
  if (routePathname === normalized) return matchFarmPagePath(normalized);
  // Pages answer at their route path, as in core's renderers: app/about/page.tsx at
  // '/console/about' under basePath "/console", and at '/console/fr/about' with an 'fr' locale.
  // A page whose folders spell out the prefix the request carries (app/console/about, or
  // app/[lang]/about for the locale) keeps the URL it had when RSC matched the path as received,
  // and any other page matching only that path still answers there. Middleware runs for both
  // paths (rawPathRouting), so the page that renders keeps its guards.
  const asReceived = matchFarmPagePath(normalized);
  if (asReceived && farmPageSpellsRoutePrefix(asReceived.segments, normalized, routePathname)) {
    return asReceived;
  }
  return matchFarmPagePath(routePathname) ?? asReceived;
}

/**
 * Whether a page matched on the path as received takes the prefix with its own folders: a static
 * folder for each basePath segment, then any folder but a catch-all for the locale. A catch-all
 * or dynamic folder that merely absorbs the basePath ('[...slug]' at the root) does not.
 */
function farmPageSpellsRoutePrefix(segments, pathname, routePathname) {
  const count = (path) => path.split('/').filter(Boolean).length;
  const prefixLength = count(pathname) - count(routePathname);
  const basePathLength = count(pathname) - count(stripFarmBasePath(pathname, farmRouteI18n.basePath));
  for (let index = 0; index < prefixLength; index++) {
    const segment = segments[index];
    if (!segment || segment.isCatchAll || (index < basePathLength && segment.isDynamic)) return false;
  }
  return true;
}
`
    : `function matchRoute(pathname) {
  return matchFarmPagePath(pathname.replace(/\\/$/, '') || '/');
}
`
}
function matchFarmPagePath(normalized) {
  for (const { filePath, module, segments } of pageRoutes) {
    const match = matchFarmPageRoute(normalized, segments);

    if (match.matches) {
      debug('Matched route:', filePath, 'for path:', normalized);
      return {
        Page: module.default,
        pattern: filePath,
        params: match.params,
        module,
        segments,
      };
    }
  }

  debug('No route matched for:', normalized);
  return null;
}

// Each page's parsed rendering directive and whether its source reads request state, baked by
// the build because module exports cannot tell.
const farmPageRenderingDirectives = ${JSON.stringify(ctx.pageRenderingDirectives ?? {})};

/**
 * The URL paths the build prerenders, by core's SSG rules: a page asks to be static
 * (dynamic = "force-static", generateStaticParams, "use ssg"), does not read request
 * state, and does not revalidate. A prerendered page is a static file the server never sees, so a
 * path any middleware may handle stays server-rendered.
 */
async function collectFarmStaticPages() {
  ${
    ctx.i18n?.enabled
      ? `console.info('[Farm.js] Prerendering is off: i18n resolves the locale per request.');
  return [];`
      : ""
  }
  const middlewareRoutes = Object.keys(middlewares)
    .map((filePath) => ({ path: middlewarePathToRoute(filePath) }))
    .filter((route) => route.path !== null);
  const paths = new Set();
  for (const { filePath, module, segments } of pageRoutes) {
    const rendering = mergeRouteRenderingDirectiveConfig(farmPageRenderingDirectives[filePath], module);
    if (!rendering.ssg || rendering.revalidate !== undefined) continue;
    const pattern = '/' + segments
      .map((part) => part.isCatchAll
        ? (part.isOptional ? '[[...' + part.segment + ']]' : '[...' + part.segment + ']')
        : part.isDynamic ? '[' + part.segment + ']' : part.segment)
      .join('/');
    let pagePaths;
    try {
      if (!segments.some((part) => part.isDynamic)) {
        pagePaths = [pattern];
      } else {
        const getStaticPaths = module.getStaticPaths || module.generateStaticParams;
        if (typeof getStaticPaths !== 'function') {
          throw new Error('a static route with dynamic segments needs generateStaticParams()');
        }
        pagePaths = (await getStaticPaths()).map((params) => materializeSSGRoutePath(pattern, params));
      }
    } catch (error) {
      console.error('[Farm.js] Rendering ' + filePath + ' on each request: could not list its static paths.', error);
      continue;
    }
    for (const pagePath of pagePaths) {
      if (
        appMiddlewareMayHandlePath(middlewareRoutes, pagePath) ||
        configMiddlewareMayHandlePath(farmConfigMiddleware, pagePath)
      ) {
        continue;
      }
      ${
        hasBasePath
          ? `// The platform serves a prerendered file only at the URL it was written for, below the
      // basePath, as core's build writes it. A page nested under app/<basePath>/ already is.
      const publicPath = applyFarmBasePath(pagePath, ${JSON.stringify(ctx.basePath)});
      paths.add(${
        ctx.trailingSlash
          ? "normalizeFarmTrailingSlashPathname(publicPath, true)"
          : "publicPath.length > 1 ? publicPath.replace(/\\/$/, '') : publicPath"
      });`
          : ctx.trailingSlash
            ? // With trailingSlash the page's URL is '/about/', which Nitro writes as about/index.html.
              "paths.add(normalizeFarmTrailingSlashPathname(pagePath, true));"
            : "paths.add(pagePath);"
      }
    }
  }
  return [...paths];
}

// The route's metadata as core's server resolves it: layouts root to leaf, then the page, each
// module's \`metadata\`, \`generateMetadata()\` and viewport exports merged in order.
async function resolveFarmRouteMetadata(layoutModules, pageModule, pageProps) {
  let metadata = {};
  for (const layoutModule of layoutModules) {
    metadata = mergeMetadata(metadata, layoutModule.metadata);
    if (typeof layoutModule.generateMetadata === 'function') {
      metadata = mergeMetadata(metadata, await layoutModule.generateMetadata({ params: pageProps.params }));
    }
    metadata = await mergeModuleViewport(metadata, layoutModule, { params: pageProps.params });
  }
  metadata = mergeMetadata(metadata, pageModule?.metadata);
  if (typeof pageModule?.generateMetadata === 'function') {
    metadata = mergeMetadata(metadata, await pageModule.generateMetadata(pageProps));
  }
  return mergeModuleViewport(metadata, pageModule ?? {}, pageProps);
}

/**
 * Find modules along the selected page's actual file ancestry, root to leaf.
 * Keep route groups and catch-all folders; matching URL prefixes can pick
 * boundaries from a sibling page that the router did not select.
 */
function getRouteModules(pageFilePath, modules, kind) {
  const tryKeys = (...keys) => {
    for (const k of keys) {
      if (modules[k]?.default) return modules[k];
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
    let matchedModule = null;
    for (const ext of extensions) {
      matchedModule = tryKeys(
        absoluteDir + '/' + kind + '.' + ext,
        relativeDir ? relativeDir + '/' + kind + '.' + ext : kind + '.' + ext,
      );
      if (matchedModule) break;
    }
    if (matchedModule) matches.push(matchedModule);
  }

  return matches;
}

function getLayoutModules(pageFilePath) {
  return getRouteModules(pageFilePath, layouts, 'layout');
}

// Flight keeps only the digest onError returns for a server error. A notFound() or redirect() keeps
// its own, so the request handler still answers 404 or the redirect; other errors are logged as
// React's default handler logs them.
function farmRscOnError(error) {
  if (getFarmRedirectError(error) || isFarmNotFoundError(error)) return error.digest;
  console.error(error);
}

function getMatchingBoundary(pageFilePath, modules, kind) {
  // Before page selection (for example, middleware failure), only the root
  // boundary applies. Do not guess a route from a partially processed URL.
  const matches = getRouteModules(pageFilePath ?? '/page.tsx', modules, kind);
  return matches.at(-1)?.default ?? null;
}

/**
 * Main request handler - entry point for both dev and production (Nitro).
 * Exported as { fetch: handler } for the RSC/Nitro contract (see vite-plugin-rsc-deploy-example).
 *
 * Middleware that let a request through may have been a guard: an IP allowlist, an API key
 * header, a VPN header. A CDN keys its copy by URL and never runs the guard on a hit, so
 * whatever such a request answers stays out of shared caches, as in core's server. Only
 * middleware declaring cache: "public" leaves the policy alone.
 */
async function handleFarmRequest(request, context) {
  const farmCacheGuard = { guarded: false };
  const response = await resolveFarmRequest(farmCacheGuard, request, context);
  return farmCacheGuard.guarded ? _withFarmGuardedResponseCache(response) : response;
}

async function resolveFarmRequest(farmCacheGuard, request, context) {
  let url = new URL(request.url);
  const isFarmPayloadRequest = farmPayloadRequests.has(request);
  let matchedPage = null;
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
  const middlewareResult = await executeMiddleware(request, context);
  ${generateRscMiddlewareResultHandling()}
  if (middlewareResult.guarded) farmCacheGuard.guarded = true;

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

  if (farmImageHandler && url.pathname === farmImagePath) {
    const imageResponse = await farmImageHandler(request);
    if (imageResponse) return imageResponse;
  }

  // A plain clone of the request would let some undici versions cancel the original's body when the
  // declined clone is collected, before a server action reads it.
  const apiResponse = await handleAPIRequest(cloneFarmRequestWithContext(request));
  if (apiResponse) {
    return applyProductionMiddlewareHeaders(apiResponse, middlewareHeaders);
  }
  ${
    ctx.llmsTxt?.enabled
      ? `// agent.llmsTxt: answered after middleware, so its redirects and headers apply.
  const llmsResponse = await handleFarmLlmsTxtRequest(request, context);
  if (llmsResponse) return applyProductionMiddlewareHeaders(llmsResponse, middlewareHeaders);
  `
      : ""
  }${
    ctx.sitemap?.enabled
      ? `// agent.sitemap: answered after middleware, as in core's servers.
  if (getFarmRoutePathname(url.pathname.replace(/\\/+$/, '') || '/') === '/sitemap.xml') {
    return applyProductionMiddlewareHeaders(createFarmAgentSitemapResponse(request), middlewareHeaders);
  }
  `
      : ""
  }if (isFarmAPIPathname(url.pathname, farmApiBasePath) || isFarmAPIPathname(url.pathname)) {
    return applyProductionMiddlewareHeaders(new Response(
      JSON.stringify({ error: 'API route not found', pathname: url.pathname }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    ), middlewareHeaders);
  }

  // A page answers at one spelling of its URL, as in core's servers: '/about/' with trailingSlash,
  // '/about' without. Any other spelling gets a 308 to it, before a server action runs, and a
  // '<page>.rsc' request is sent to the payload URL of that page.
  const trailingSlashLocation = resolveFarmTrailingSlashRedirect(url, ${JSON.stringify(ctx.trailingSlash === true)});
  if (trailingSlashLocation && matchRoute(url.pathname)) {
    const target = new URL(trailingSlashLocation, url);
    return applyProductionMiddlewareHeaders(new Response(null, {
      status: 308,
      headers: {
        location: isFarmPayloadRequest ? farmPayloadPath(target.pathname) + target.search : trailingSlashLocation,
      },
    }), middlewareHeaders);
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
        // redirect() unwinds by throwing, so it arrives here looking like a
        // failure. It is control flow, not an error: carry it to the client as
        // data so the router can navigate. Everything else still goes through
        // sanitizeServerActionError untouched.
        const actionRedirect = getFarmRedirectError(e);
        if (actionRedirect) {
          returnValue = { ok: false, redirect: { url: actionRedirect.url, status: actionRedirect.status } };
          debug('Server action redirected:', actionId, actionRedirect.url);
        } else {
          const actionError = sanitizeServerActionError(e);
          if (actionError.name === 'ServerActionError') {
            console.error('[Farm.js] Server action failed:', e);
          }
          returnValue = { ok: false, data: actionError };
          debug('Server action failed:', actionId, e);
        }
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
        // No client router here, so the redirect has to be a real HTTP
        // redirect the browser follows on its own. 303 makes it a GET, as islands mode
        // answers: a 307 or 308 would post the form again to the target.
        const formRedirect = getFarmRedirectError(e);
        if (formRedirect) {
          debug('Form action redirected:', formRedirect.url);
          return new Response(null, {
            status: 303,
            headers: { location: formRedirect.url, 'Cache-Control': 'no-store' },
          });
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
  matchedPage = matched;
  
  if (!matched) {
    debug('404 - No route found for:', url.pathname);
    // Agents that read in Markdown get a Markdown 404, as in core's server.
    if (farmMarkdownConfig.enabled && farmRequestWantsMarkdown(url.pathname, request.headers.get('accept'))) {
      return new Response(createFarmMarkdownErrorBody(404, url.pathname), {
        status: 404,
        headers: {
          'Content-Type': FARM_MARKDOWN_CONTENT_TYPE,
          'X-Farm-Markdown-Error': '404',
          'Cache-Control': 'no-store',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  }
  
  const { Page, pattern, params, module: pageModule } = matched;
  ${
    isolateRouteModules
      ? `const routeLoadError = findFarmRouteLoadError(matched);
  if (routeLoadError) throw routeLoadError;
  `
      : ""
  }const LayoutModules = getLayoutModules(pattern);
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
  ${
    ctx.markdown?.enabled
      ? `// The head advertises the page's Markdown mirror as the Link header does, as in core's servers.
  const metadata = addMetadataMarkdownAlternate(
    await resolveFarmRouteMetadata(LayoutModules, pageModule, pageProps),
    getFarmMarkdownAlternatePath(farmMarkdownConfig, url.pathname, { routePathname: getFarmRoutePathname }),
  );`
      : "const metadata = await resolveFarmRouteMetadata(LayoutModules, pageModule, pageProps);"
  }
  const renderedHead = renderMetadataHead(metadata, { pathname: url.pathname });
  // Injected into <head> by the SSR entry; React renders only the charset.
  const metadataHead =
    (renderedHead.hasExplicitTitle ? '<title>' + renderedHead.title + '</title>' : '') +
    renderedHead.viewport +
    renderedHead.tags;
  const metadataTitle = resolveMetadataTitle(metadata.title);
  
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
  const LoadingComponent = getMatchingBoundary(pattern, loadings, 'loading');
  if (LoadingComponent) {
    const loadingFallback = h(LoadingComponent, { params, path: url.pathname });
    pageContent = h(React.Suspense, { fallback: loadingFallback }, pageContent);
  }
  
  // Route-level error boundary (Next.js error.tsx): catches render errors in this segment
  const ErrorComponent = getMatchingBoundary(pattern, errors, 'error');
  if (ErrorComponent) {
    pageContent = h(RouteErrorBoundary, {
      Fallback: ErrorComponent,
      fallbackProps: { params, path: url.pathname, searchParams },
      children: pageContent,
    });
  }
  
  // A native-tier screen reads only the page (RFC 0004): mark it, for the server's own render of
  // the tree only (the handler strips this header from every other request).
  if (request.headers.get('x-farm-native-tree') === '1') {
    pageContent = h('div', { id: '__farm_page__', 'data-farm-segment': 'page' }, pageContent);
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
  
  // A root layout that renders <html> owns the document, as in Next.js: the head elements below
  // are hoisted into its <head> by React, and the browser hydrates the whole document.
  const ownsDocument =
    LayoutModules.length > 0 && farmDocumentLayoutModules.has(LayoutModules[0]);
  // Otherwise a single wrapper, so #root has exactly one child (avoids a duplicate block in the DOM).
  const rootInner = ownsDocument
    ? h(
        React.Fragment,
        null,
        h('meta', { charSet: 'utf-8' }),
        layoutContent,
      )
    : h('div', { 'data-farm-root': 'true' }, layoutContent);
  // Build the full page. root = full document (for SSR). rootContent = what the browser hydrates.
  const payload = {
    ownsDocument,
    root: ownsDocument ? rootInner : h('html', null,
        h('head', null,
          h('meta', { charSet: 'utf-8' }),
          renderedHead.hasFavicon ? null : h('link', { rel: 'icon', href: 'data:,' }),
        ),
      h('body', null,
        h('div', { id: 'root' }, rootInner)
      )
    ),
    rootContent: rootInner,
    metadataHead,
    metadata: {
      title: metadataTitle,
      description: typeof metadata.description === 'string' ? metadata.description : undefined,
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
    
    const rscStream = renderToReadableStream(payload, { onError: farmRscOnError${ctx.actionsEnabled ? ", temporaryReferences" : ""} });
    
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
      metadataTitle ? h('title', null, metadataTitle) : null,
      typeof metadata.description === 'string' ? h('meta', { name: 'description', content: metadata.description }) : null,
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
    ${
      isolateRouteModules
        ? `// A file that failed to load: show the dev error page, not error.tsx.
    if ([...farmRouteLoadErrors.values()].includes(err)) throw err;
    `
        : ""
    }const redirect = getFarmRedirectError(err);
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
    const ErrorComponent = getMatchingBoundary(matchedPage?.pattern, errors, 'error');
    if (ErrorComponent) {
      try {
        return await _runWithCurrentRequest(request, () =>
          _runWithMiddlewareData(errorData, () =>
            _runWithMiddlewareContext(errorContext, async () => {
              const h = React.createElement;
              const errSearchParams = searchParamsToObject(url.searchParams);
              const fallbackProps = {
                params: matchedPage?.params || {},
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
              const rscStream = renderToReadableStream(payload, { onError: farmRscOnError });
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

${
  ctx.llmsTxt?.enabled
    ? `/**
 * agent.llmsTxt, built the same way as core's production server: /llms.txt
 * lists the app's static pages and links to their Markdown mirrors, and
 * /llms-full.txt inlines each mirror.
 */
function createFarmLlmsTxtContext(request, context, full) {
  const origin = getFarmAgentOrigin(request);
  // Each page links to its public URL below the basePath ('/console/index.md' for the home page),
  // and include and exclude match its route path, as in core's servers.
  const pages = collectFarmLlmsTxtPages(
    getFarmAgentListedPages().map(({ pattern, module }) => ({
      pattern,
      metadata: module && module.metadata,
    })),
    {
      origin,
      basePath: ${JSON.stringify(ctx.basePath)},
      markdown: farmMarkdownConfig,
      include: farmLlmsTxtConfig.include,
      exclude: farmLlmsTxtConfig.exclude,
    },
  );
  const rootLayout = getRouteModules('/page.tsx', layouts, 'layout')[0];
  return {
    origin,
    defaults: createFarmDefaultLlmsTxt({
      origin,
      pages,
      config: farmLlmsTxtConfig,
      rootMetadata: rootLayout && rootLayout.metadata,
    }),
    // Pages are read in-process through the full handler as an anonymous
    // visitor: a fresh request, so the caller's cookies never shape the file,
    // and a neutral client address, so an IP allowlist never admits the read.
    // The body is shared across callers. HEAD reads nothing.
    markdown: full && request.method.toUpperCase() !== 'HEAD'
      ? createFarmLlmsMarkdownReader((page) =>
          handler(page, {
            waitUntil: context && context.waitUntil,
            clientAddress: FARM_MARKDOWN_ANONYMOUS_CLIENT_ADDRESS,
          }),
        )
      : async () => null,
  };
}

async function handleFarmLlmsTxtRequest(request, context) {
  const { origin, pathname } = new URL(request.url);
  // Served at the path routes see, as core serves it: /console/llms.txt under basePath "/console".
  const routePathname = getFarmRoutePathname(pathname.replace(/\\/+$/, '') || '/');
  const kind = routePathname === '/llms.txt'
    ? 'llms'
    : farmLlmsTxtConfig.full && routePathname === '/llms-full.txt' ? 'llms-full' : null;
  if (!kind) return null;
  const method = request.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const llmsContext = createFarmLlmsTxtContext(request, context, kind === 'llms-full');
  // A page that times out is left out, and that response is neither reused nor cached.
  let complete = true;
  const renderFull = (shared) =>
    renderFarmLlmsFullTxt(llmsContext.defaults, {
      origin: llmsContext.origin,
      readMarkdown: llmsContext.markdown,
      onIncomplete: () => {
        complete = false;
        if (shared) shared.incomplete();
      },
    });
  // HEAD reads no pages, so it neither waits for nor fills the shared render.
  const body = kind === 'llms'
    ? llmsContext.defaults
    : method === 'HEAD'
      ? await renderFull()
      : await farmLlmsFullRenderer(origin, renderFull, (settled) => {
          complete = settled;
        });
  const response = createFarmMetadataRouteResponse(
    kind,
    body,
    { revalidate: complete ? farmLlmsTxtConfig.revalidate : 0 },
    { method, request },
  );
  if (!complete) response.headers.set('cache-control', 'no-store');
  return response;
}

`
    : ""
}${
    listsAgentPages
      ? `/**
 * The static pages the generated agent files list, as core's servers pick them: each at its route
 * path, below the basePath and locale, leaving out a page a path-specific guard (a non-root
 * middleware.ts, a config middleware matcher naming the path) or a route guard covers, and one
 * that renders noindex through its own robots or, without one, its nearest layout's.
 */
function getFarmAgentListedPages() {
  const guard = {
    config: { middleware: farmConfigMiddleware },
    middlewareRoutes: Object.keys(middlewares)
      .map((filePath) => ({ path: middlewarePathToRoute(filePath) }))
      .filter((route) => route.path !== null),
  };
  const listed = new Map();
  for (const { filePath, module, segments } of pageRoutes) {
    // Dynamic routes have no single URL.
    if (segments.some((part) => part.isDynamic)) continue;
    const filePattern = '/' + segments.map((part) => part.segment).join('/');
    ${
      routesBelowPrefix
        ? `// A page nested under app/<basePath>/ answers at the path without it, and wins there, as
    // matchRoute() selects it.
    const routePathname = getFarmRoutePathname(filePattern);
    const nested = routePathname !== filePattern &&
      farmPageSpellsRoutePrefix(segments, filePattern, routePathname);
    const pattern = nested ? routePathname : filePattern;
    const current = listed.get(pattern);
    if (current && (current.nested || !nested)) continue;`
        : `const pattern = filePattern;
    const nested = false;
    if (listed.has(pattern)) continue;`
    }
    listed.set(pattern, { filePath, filePattern, pattern, module, nested });
  }
  // Middleware runs for both the path as received and the route path, so either may guard it.
  return [...listed.values()].filter(({ filePath, filePattern, pattern, module }) =>
    !farmPathGuardCoversPage(guard, filePattern) &&
    !farmPathGuardCoversPage(guard, pattern) &&
    !(module && module.__farmRouteGuard) &&
    !isFarmPageNoIndex(
      module && module.metadata,
      getRouteModules(filePath, layouts, 'layout').map((layout) => layout.metadata),
    ),
  );
}

${
  ctx.sitemap?.enabled
    ? `/**
 * agent.sitemap, built the same way as core's servers build it: the pages llms.txt lists, each at
 * its URL below the basePath, on the root layout's metadataBase or the request's origin.
 */
function createFarmAgentSitemapResponse(request) {
  const rootLayout = getRouteModules('/page.tsx', layouts, 'layout')[0];
  return createFarmMetadataRouteResponse(
    'sitemap',
    createFarmDefaultSitemap(
      getFarmAgentListedPages().map(({ filePath, pattern, module }) => ({
        pattern,
        module,
        lastModified: farmPageLastModified[filePath],
      })),
      {
        origin: new URL(request.url).origin,
        config: farmAgentSitemapConfig,
        metadataBase: rootLayout && rootLayout.metadata ? rootLayout.metadata.metadataBase : undefined,
        basePath: ${JSON.stringify(ctx.basePath)},
      },
    ),
    {},
    { method: request.method },
  );
}

`
    : ""
}// Agent files link to the root layout's metadataBase when it is an absolute URL, else to the
// request's origin, as in core's servers.
function getFarmAgentOrigin(request) {
  const rootLayout = getRouteModules('/page.tsx', layouts, 'layout')[0];
  return resolveFarmAgentOrigin(
    rootLayout && rootLayout.metadata ? rootLayout.metadata.metadataBase : undefined,
    new URL(request.url).origin,
  );
}

`
      : ""
  }/**
 * Serves a page's Markdown mirror (\`/page.md\` or \`Accept: text/markdown\`) by
 * rendering the page through the normal request path, so middleware and sign-in
 * gates apply; every other request renders as usual, and HTML pages advertise
 * their mirror with a Link header.
 */
async function handleFarmPageOrMarkdown(request, context) {
  if (!farmMarkdownConfig.enabled) return handleFarmRequest(request, context);
  const markdown = await createMarkdownMirrorResponse({
    request,
    config: farmMarkdownConfig,
    routePathname: getFarmRoutePathname,
    // The page the render below selects for the mirrored URL, below the basePath and locale.
    routeExists: (pathname) => Boolean(matchRoute(pathname)),
    renderPage: (pageRequest) => handleFarmRequest(${ctx.trailingSlash ? "toFarmTrailingSlashPageRequest(pageRequest)" : "pageRequest"}, context),
    apiServerBasePath: farmApiBasePath,
  });
  if (markdown) return markdown;
  const response = await handleFarmRequest(request, context);
  return applyMarkdownNegotiationHeaders(response, {
    config: farmMarkdownConfig,
    pathname: new URL(request.url).pathname,
    routePathname: getFarmRoutePathname,
  });
}
${
  ctx.trailingSlash
    ? `
// The mirror reads the page at its canonical URL ('/about/'), so the trailing-slash redirect never
// answers in its place.
function toFarmTrailingSlashPageRequest(request) {
  const url = new URL(request.url);
  const pathname = normalizeFarmTrailingSlashPathname(url.pathname, true);
  if (pathname === url.pathname) return request;
  url.pathname = pathname;
  return new Request(url, request);
}
`
    : ""
}
// Client navigation addresses a page's RSC payload as '<page>.rsc' ('<dir>/index.rsc' for a
// trailing slash), so a prerendered page can be a static HTML file next to a static payload file.
// 'Accept: text/x-component' on the page URL keeps working.
function farmPayloadPath(pathname) {
  return pathname.endsWith('/') ? pathname + 'index.rsc' : pathname + '.rsc';
}

// The requests made from a '<page>.rsc' URL, whose redirects name a payload URL too.
const farmPayloadRequests = new WeakSet();

function toFarmPayloadRequest(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return request;
  const url = new URL(request.url);
  if (!url.pathname.endsWith('.rsc')) return request;
  if (isFarmAPIPathname(url.pathname, farmApiBasePath) || isFarmAPIPathname(url.pathname)) return request;
  const page = url.pathname.slice(0, -'.rsc'.length);
  url.pathname = page.endsWith('/index') ? page.slice(0, -'index'.length) : page;
  const headers = new Headers(request.headers);
  headers.set('accept', 'text/x-component');
  const payloadRequest = new Request(url, { method: request.method, headers, signal: request.signal });
  farmPayloadRequests.add(payloadRequest);
  return payloadRequest;
}

// The build's prerender pass (Nitro) runs this server with FARM_RSC_PRERENDER set. It seeds one
// route that lists the static pages, and each prerendered page queues its payload, both through
// Nitro's x-nitro-prerender response header. Production servers never answer either.
const FARM_PRERENDER_ROUTES_PATH = '/__farm/rsc-prerender-routes';
function isFarmPrerenderRequest(request) {
  return globalThis.process?.env?.FARM_RSC_PRERENDER === '1' && request.headers.has('x-nitro-prerender');
}

${
  ctx.mobileClient
    ? `// The server's own renders of a page for a native-tree answer: only these mark the page.
const farmNativeTreeRenders = new WeakSet();
`
    : ""
}async function handler(request, context) {${
    ctx.mobileClient
      ? `
  if (request.headers.has('x-farm-native-tree') && !farmNativeTreeRenders.has(request)) {
    const headers = new Headers(request.headers);
    headers.delete('x-farm-native-tree');
    request = new Request(request, { headers });
  }`
      : ""
  }
  const prerendering = isFarmPrerenderRequest(request);
  if (prerendering && new URL(request.url).pathname === FARM_PRERENDER_ROUTES_PATH) {
    const pages = await collectFarmStaticPages();
    return new Response('<!doctype html>', {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-nitro-prerender': pages.map(encodeURIComponent).join(','),
      },
    });
  }
${
  ctx.mobileClient
    ? `  // A native-tier screen of the mobile app (RFC 0004): the page, rendered as for a browser,
  // read into a tree of native views. A POST is a form the screen submitted, such as a server
  // action's: it runs as the browser's no-JavaScript submission would.
  if (
    (request.method === 'GET' || request.method === 'HEAD' || request.method === 'POST') &&
    (request.headers.get('accept') || '').includes('application/vnd.farm.native+json')
  ) {
    return createFarmNativeTreeResponse({
      request,
      renderPage: (target) => {
        farmNativeTreeRenders.add(target);
        return handler(target, context);
      },
      // Behind a proxy that terminates TLS, links and server-action forms use the forwarded
      // origin (under server.trustProxy), so the shell posts to https:// as the browser does.
      origin: resolveFarmWebRequestOrigin(request, {
        trustProxy: ${JSON.stringify(ctx.server?.trustProxy === true)},
      }),
      loadStylesheet: ${
        ctx.mobileClient === "entry"
          ? "(href) => farmNativeStylesheets[href]"
          : `async (href) => {
        // farm dev: Vite serves the CSS, so ask this dev server for it over loopback.
        const url = new URL(href, request.url);
        url.hostname = '127.0.0.1';
        const response = await fetch(url, { headers: { accept: 'text/css,*/*;q=0.1' } }).catch(() => null);
        return response?.ok && (response.headers.get('content-type') || '').includes('text/css')
          ? response.text()
          : undefined;
      }`
      },
    });
  }
`
    : ""
}  const pageRequest = toFarmPayloadRequest(request);
  const response = await handleFarmRequestWithRuntime(pageRequest, context);
  if (
    prerendering &&
    pageRequest === request &&
    response.status === 200 &&
    (response.headers.get('content-type') || '').includes('text/html')
  ) {
    const headers = new Headers(response.headers);
    headers.set('x-nitro-prerender', encodeURIComponent(farmPayloadPath(new URL(request.url).pathname)));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
  return ${ctx.mobileClient === "entry" ? "_applyFarmMobileShellClient(request, response, farmMobileShellClient)" : "response"};
}
${
  ctx.mobileClient === "entry"
    ? `
// The mobile client (RFC 0004): the documents a mobile shell asks for (X-Farm-Shell) load its
// entry instead of the web one, privately, and every HTML response varies on the header. The
// Nitro build fills this in once the client is built; null leaves responses as they are.
function readFarmMobileShellClient() {
  try {
    return JSON.parse("${FARM_RSC_MOBILE_SHELL_CLIENT_PLACEHOLDER}");
  } catch {
    return null;
  }
}
const farmMobileShellClient = readFarmMobileShellClient();
// The client CSS by href, embedded by the build for native-tier screens.
const farmNativeStylesheets = (() => {
  try {
    return JSON.parse("${FARM_RSC_NATIVE_STYLESHEETS_PLACEHOLDER}");
  } catch {
    return {};
  }
})();
`
    : ""
}

async function handleFarmRequestWithRuntime(request, context) {
  return _runWithAPIRequestRuntime({
    basePath: farmApiBasePath,
    dispatch: async (localRequest) =>
      (await handleAPIRequest(localRequest)) ?? Response.json({ error: 'Not Found' }, { status: 404 }),
  }, () => _runWithCurrentRequest(request, () =>
    _runWithAfterRequest(request, () => handleFarmPageOrMarkdown(request, context), context)
  ));
}

export default { fetch: handler };

// Enable HMR - when server files change, accept the update
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;

  return code;
}
