import type { EntryContext } from "../types.js";
import { generateMobileShellNavigation } from "../mobile-client.js";

// The browser entry always loads, so what it imports must be optimized before the first page.
export const CLIENT_ENTRY_CORE_IMPORTS = [
  "@farm.js/core/client",
  "@farm.js/core/deployment",
  "@farm.js/core/internal/client-runtime",
  "@farm.js/core/server-query/client",
] as const;

export const serverFnTransportErrorClientRuntime = `function createFarmServerFnTransportError(value) {
  const message = value && typeof value === 'object' && typeof value.message === 'string'
    ? value.message
    : 'Server function failed';
  const error = new Error(message);

  if (
    value &&
    typeof value === 'object' &&
    value.name === 'ServerFnFailure' &&
    typeof value.code === 'string' &&
    Number.isInteger(value.status) &&
    value.status >= 400 &&
    value.status <= 599 &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  ) {
    error.name = 'ServerFnFailure';
    error.code = value.code;
    error.status = value.status;
    error.data = value.data;
    Object.defineProperty(error, Symbol.for('farm.server-fn.failure'), {
      value: true,
      enumerable: false,
    });
    return error;
  }

  error.name = 'ServerActionError';
  return error;
}`;

/**
 * Generates the browser entry file.
 *
 * This entry file:
 * - Reads the embedded RSC payload from the HTML (via rsc-html-stream)
 * - Deserializes it to React elements
 * - Sets up client-side navigation (intercepts links, handles popstate)
 * - Registers server action callback if enabled
 * - Hydrates the page
 * - Listens for HMR updates from server components
 */
export function generateClientEntry(ctx: EntryContext): string {
  const debugLog = `// Debug disabled`;
  const globalStylesheetImport = ctx.globalCssPath
    ? `const farmGlobalStylesheets = import.meta.glob(${JSON.stringify(ctx.globalCssPath)}, {
  eager: true,
  import: 'default',
  query: '?url',
});
export const farmGlobalStylesheet = Object.values(farmGlobalStylesheets)[0];
`
    : "";
  let imports = `${globalStylesheetImport}
import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createFromReadableStream } from '@vitejs/plugin-rsc/browser';
import { rscStream } from 'rsc-html-stream/client';
import {
  createFarmDeploymentMismatchError,
  createFarmDeploymentRequestHeaders,
  isFarmDeploymentMismatchResponse,
} from '@farm.js/core/deployment';
import { runFarmNavigationDelegates } from '@farm.js/core/internal/client-runtime';
`;

  // farm dev --mobile: every page runs in the shell's WebView, so this entry is the mobile client.
  if (ctx.mobileClient === "inline") {
    imports += generateMobileShellNavigation();
  }

  if (ctx.actionsEnabled) {
    imports += `import { setServerCallback, encodeReply, createTemporaryReferenceSet } from '@vitejs/plugin-rsc/browser';
import { applyFarmCacheInvalidations } from '@farm.js/core/internal/client-runtime';
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
  shouldApplyFarmServerQueryActionResult,
} from '@farm.js/core/server-query/client';
`;
  }

  // Module-level ref so the server-action callback can update UI (assigned in BrowserRoot useEffect).
  // Set __viteRscCallServer immediately so it's never undefined when other chunks call it (then replace with real impl).
  let actionSetup = "";
  if (ctx.actionsEnabled) {
    actionSetup = `
${serverFnTransportErrorClientRuntime}

// Refs for payload setter and router navigation. refetch() is defined inside
// main(), so the action callback reaches it through this ref rather than by
// closing over it.
const setPayloadRef = { current: null };
const farmNavigateRef = { current: null };

// Ensure __viteRscCallServer is a function before any other chunk may call it (avoids "is not a function")
if (typeof globalThis.__viteRscCallServer !== 'function') {
  globalThis.__viteRscCallServer = () => Promise.reject(new Error('Farm.js: server actions not ready'));
}
// Register real callback (replaces placeholder above)
setServerCallback(async (id, args) => {
  debug('Invoking server action:', id);
  const serverQueryInvocation = beginFarmServerQueryAction(id, args);
  const refs = createTemporaryReferenceSet();
  const body = await encodeReply(args, { temporaryReferences: refs });
  const headers = createFarmDeploymentRequestHeaders(farmDeploymentId, {
    'x-farm-action-id': id,
    'Accept': 'text/x-component',
  });
  if (typeof body === 'string') headers.set('Content-Type', 'text/plain; charset=utf-8');
  else if (!(body instanceof FormData)) headers.set('Content-Type', 'application/octet-stream');
  const res = await fetch(location.href, {
    method: 'POST',
    headers,
    body,
    cache: 'no-store',
    credentials: 'same-origin',
    redirect: 'error',
  });
  if (isFarmDeploymentMismatchResponse(res, farmDeploymentId)) {
    throw reportDeploymentMismatch(res);
  }
  if (!res.ok) {
    const text = await res.text();
    console.error('[Farm.js] Server action request failed:', res.status, text);
    throw new Error('Server action failed: ' + res.status);
  }
  let p;
  try {
    p = await createFromReadableStream(res.body, { temporaryReferences: refs });
  } catch (e) {
    console.error('[Farm.js] Failed to deserialize action response:', e);
    throw e;
  }
  const hasContent = p && (typeof p.root !== 'undefined' || typeof p.rootContent !== 'undefined');
  if (!hasContent) {
    console.error('[Farm.js] Action response missing payload.root / payload.rootContent');
    return;
  }
  if (shouldApplyFarmServerQueryActionResult(serverQueryInvocation)) {
    setPayloadRef.current?.(p);
    applyFarmCacheInvalidations(p.returnValue?.invalidations);
  }
  if (!p.returnValue || !p.returnValue.ok) {
    // A redirect() from the action comes back as data, not as a 3xx, so the
    // router performs the navigation here.
    if (p.returnValue?.redirect?.url) {
      debug('Server action redirected:', p.returnValue.redirect.url);
      await farmNavigateRef.current?.(p.returnValue.redirect.url, 'push');
      return;
    }
    debug('Server action failed:', id);
    throw createFarmServerFnTransportError(p.returnValue?.data);
  }
  return completeFarmServerQueryAction(serverQueryInvocation, p.returnValue.data);
});
`;
  } else {
    actionSetup = `
const setPayloadRef = { current: null };
const farmNavigateRef = { current: null };
`;
  }

  return `${imports}
${ctx.clientCachePersistence?.imports ?? ""}
${actionSetup}
${ctx.clientCachePersistence?.init ?? ""}
const farmDeploymentId = ${JSON.stringify(ctx.deploymentId)};

function reportDeploymentMismatch(response) {
  const error = createFarmDeploymentMismatchError(response, farmDeploymentId);
  globalThis.dispatchEvent?.(new CustomEvent('farm:deployment-mismatch', { detail: error }));
  return error;
}

// Debug logging helper
function debug(...args) {
  ${debugLog}
}

// A server component that fails while a client navigation renders it: a redirect() becomes a
// client navigation to its target, and anything else loads the URL as a document, so the server
// answers with its status and error.tsx. Errors in the first render are left to React.
class FarmNavigationErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, payload: props.payload };
  }
  static getDerivedStateFromProps(props, state) {
    return props.payload === state.payload ? null : { error: null, payload: props.payload };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error) {
    const digest = error && typeof error.digest === 'string' ? error.digest : '';
    if (digest.startsWith('FARM_REDIRECT;')) {
      farmNavigateRef.current?.(digest.split(';').slice(2).join(';'), 'replace');
      return;
    }
    location.reload();
  }
  render() {
    if (this.state.error && !this.props.navigated) throw this.state.error;
    return this.state.error ? null : this.props.children;
  }
}

async function main() {
  // Prevent double execution (e.g. script loaded twice)
  if (globalThis.__FARM_RSC_HYDRATED) return;
  
  debug('Starting client hydration');
  
  // Clean duplicate DOM as early as possible (server may have sent two blocks). Only Farm's own
  // wrapper: an app that owns the document can have an element with id="root" in its content.
  const rootEl = document.getElementById('root');
  if (rootEl && rootEl.firstElementChild?.hasAttribute('data-farm-root')) {
    while (rootEl.children.length > 1) rootEl.lastElementChild.remove();
    while (rootEl.nextElementSibling) rootEl.nextElementSibling.remove();
  }
  
  // Deserialize the initial RSC payload embedded in HTML
  // rscStream extracts the payload from <script> tags added by SSR
  let initial;
  try {
    initial = await createFromReadableStream(rscStream);
    debug('Initial RSC payload deserialized');
  } catch (e) {
    console.error('[Farm.js] Failed to deserialize RSC payload:', e);
    return;
  }
  
  // Root component that manages RSC state
  function BrowserRoot() {
    const [payload, set] = React.useState(initial);
    
    // Expose setter for external updates (navigation, actions, HMR)
    React.useEffect(() => {
      setPayloadRef.current = (p) => React.startTransition(() => set(p));
    }, []);

    // Keep document metadata in sync when an RSC navigation swaps only #root.
    React.useEffect(() => {
      if (typeof payload.metadata?.title === 'string') {
        document.title = payload.metadata.title;
      } else {
        document.title = '';
      }
      let description = document.querySelector('meta[name="description"]');
      if (typeof payload.metadata?.description === 'string') {
        if (!description) {
          description = document.createElement('meta');
          description.setAttribute('name', 'description');
          document.head.appendChild(description);
        }
        description.setAttribute('content', payload.metadata.description);
      } else {
        description?.remove();
      }
    }, [payload.metadata?.title, payload.metadata?.description]);
    
    // Set up client-side navigation
    React.useEffect(() => {
      // Re-fetch RSC when URL changes
      const nav = () => refetch(location.href);
      
      // Handle browser back/forward
      window.addEventListener('popstate', nav);
      
      // Intercept link clicks for client-side navigation
      const handleClick = (e) => {
        const a = e.target.closest('a');
        if (a?.href && a.origin === location.origin && !a.download && !a.target) {
          // Check for special attributes that should skip SPA navigation
          if (a.hasAttribute('data-native') || a.hasAttribute('data-reload')) {
            return;
          }
          if (e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
          if (e.button !== 0) return;

          // Same-document fragment link: let the browser update the hash and
          // scroll to the anchor natively. Refetching the route here would
          // discard the browser's fragment scroll and re-render for nothing.
          if (a.hash && a.pathname === location.pathname && a.search === location.search) {
            return;
          }

          e.preventDefault();
          // Link replace marks its anchor; a plain anchor pushes.
          navigate(a.href, a.hasAttribute('data-replace') ? 'replace' : 'push');
        }
      };
      
      document.addEventListener('click', handleClick, true);
      
      return () => {
        window.removeEventListener('popstate', nav);
        document.removeEventListener('click', handleClick, true);
      };
    }, []);
    
    // Never render payload.root (full document) on the client - it creates a second visible block (entire page duplicated below).
    // Only render rootContent (layout+page for #root).
    const content = payload.rootContent;
    if (content == null) {
      if (payload.root != null) console.warn('[Farm.js] payload.rootContent missing; not using payload.root to avoid duplicate block. Keys:', Object.keys(payload));
      return null;
    }
    return React.createElement(
      FarmNavigationErrorBoundary,
      { payload, navigated: payload !== initial },
      content,
    );
  }
  
  // An in-app navigation (a link click, a redirect after a server action). Navigation delegates
  // get it first, after the router's own checks, as Farm's other routers offer it: one that takes
  // it (a native shell showing the URL on its own screen) leaves the page and URL as they are.
  // Back/forward, refreshes and same-page moves are not offered; other origins load as documents.
  async function navigate(href, action) {
    const url = new URL(href, location.href);
    if (url.origin !== location.origin) {
      location.assign(url.href);
      return;
    }
    const from = location.pathname + location.search;
    const to = url.pathname + url.search;
    if (to !== from && (await runFarmNavigationDelegates({ url: url.href, from, to, action }))) {
      return;
    }
    if (action === 'replace') history.replaceState(null, '', url.href);
    else history.pushState(null, '', url.href);
    await refetch(location.href);
  }
  farmNavigateRef.current = navigate;

  // Fetch new RSC payload for a URL
  async function refetch(url) {
    debug('Fetching RSC for:', url);
    
    try {
      // Request the page's RSC payload, '<page>.rsc', which a prerendered page serves as a
      // static file. The page URL itself may be static HTML.
      const payloadUrl = new URL(url, location.href);
      payloadUrl.pathname = payloadUrl.pathname.endsWith('/')
        ? payloadUrl.pathname + 'index.rsc'
        : payloadUrl.pathname + '.rsc';
      const res = await fetch(payloadUrl, {
        headers: createFarmDeploymentRequestHeaders(farmDeploymentId, {
          Accept: 'text/x-component',
        }),
      });
      if (isFarmDeploymentMismatchResponse(res, farmDeploymentId)) {
        reportDeploymentMismatch(res);
        location.assign(url);
        return;
      }
      
      if (!res.ok) {
        console.error('[Farm.js] RSC fetch failed:', res.status);
        // Fall back to full page navigation
        location.href = url;
        return;
      }
      
      // A server redirect during navigation is followed transparently by
      // fetch, so the payload is for res.url while the address bar still shows
      // the URL the click pushed. Reconcile it so refresh, share, and back all
      // reflect the page actually rendered (auth gates redirect this way).
      if (res.redirected && res.url) {
        const dest = new URL(res.url);
        if (dest.pathname.endsWith('.rsc')) {
          const page = dest.pathname.slice(0, -'.rsc'.length);
          dest.pathname = page.endsWith('/index') ? page.slice(0, -'index'.length) : page;
        }
        if (dest.origin === location.origin) {
          const target = dest.pathname + dest.search + dest.hash;
          if (target !== location.pathname + location.search + location.hash) {
            history.replaceState(null, '', target);
          }
        }
      }
      const newPayload = await createFromReadableStream(res.body);
      setPayloadRef.current?.(newPayload);
      debug('RSC navigation complete');
    } catch (e) {
      console.error('[Farm.js] RSC navigation failed:', e);
      // Fall back to full page navigation
      location.href = url;
    }
  }
  // A root layout that renders <html> owns the document: hydrate it whole, as Next.js does.
  const rootElForHydrate = initial.ownsDocument ? document : document.getElementById('root');
  if (!rootElForHydrate) {
    console.error('[Farm.js] #root element not found');
    return;
  }
  if (!initial.ownsDocument) {
    // Final cleanup pass before hydrate (in case DOM changed during async)
    while (rootElForHydrate.children.length > 1) rootElForHydrate.lastElementChild.remove();
    while (rootElForHydrate.nextElementSibling) rootElForHydrate.nextElementSibling.remove();
  }
  debug('Hydrating application');
  globalThis.__FARM_RSC_HYDRATED = true;
  // The server renders #root inside <html>{[<head>, <body>]}</html>. That two-child fork is part of
  // every useId below it, so the client hydrates #root at the same position (second of two) and
  // its ids match the HTML's. A document the root layout owns is hydrated whole, as rendered.
  const hydrated = initial.ownsDocument
    ? React.createElement(BrowserRoot)
    : [null, React.createElement(BrowserRoot, { key: 'root' })];
  hydrateRoot(rootElForHydrate, hydrated, {
    formState: initial.formState,
  });
  
  // Handle HMR for server components
  // When server code changes, re-fetch and re-render
  if (import.meta.hot) {
    import.meta.hot.on('rsc:update', () => {
      debug('HMR update received, refetching...');
      refetch(location.href);
    });
  }
}

// Start the application
main().catch((e) => {
  console.error('[Farm.js] Client initialization failed:', e);
});
`;
}
