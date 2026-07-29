import type { EntryContext } from "../types.js";

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
`;

  if (ctx.actionsEnabled) {
    imports += `import { setServerCallback, encodeReply, createTemporaryReferenceSet } from '@vitejs/plugin-rsc/browser';
import { applyFarmCacheInvalidations } from '@farm.js/core/cache';
import {
  beginFarmServerQueryAction,
  completeFarmServerQueryAction,
} from '@farm.js/core/server-query/client';
`;
  }

  // Module-level ref so the server-action callback can update UI (assigned in BrowserRoot useEffect).
  // Set __viteRscCallServer immediately so it's never undefined when other chunks call it (then replace with real impl).
  let actionSetup = "";
  if (ctx.actionsEnabled) {
    actionSetup = `
// Ref for payload setter (used by server action callback and refetch)
const setPayloadRef = { current: null };

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
  setPayloadRef.current?.(p);
  applyFarmCacheInvalidations(p.returnValue?.invalidations);
  if (!p.returnValue || !p.returnValue.ok) {
    debug('Server action failed:', id);
    const error = new Error(p.returnValue?.data?.message || 'Server function failed');
    error.name = 'ServerActionError';
    throw error;
  }
  return completeFarmServerQueryAction(serverQueryInvocation, p.returnValue.data);
});
`;
  } else {
    actionSetup = `
const setPayloadRef = { current: null };
`;
  }

  return `${imports}
${actionSetup}
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

async function main() {
  // Prevent double execution (e.g. script loaded twice)
  if (globalThis.__FARM_RSC_HYDRATED) return;
  
  debug('Starting client hydration');
  
  // Clean duplicate DOM as early as possible (server may have sent two blocks)
  const rootEl = document.getElementById('root');
  if (rootEl) {
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
          
          e.preventDefault();
          history.pushState(null, '', a.href);
          nav();
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
    return content;
  }
  
  // Fetch new RSC payload for a URL
  async function refetch(url) {
    debug('Fetching RSC for:', url);
    
    try {
      // Request RSC format instead of HTML
      const res = await fetch(url, {
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
      
      const newPayload = await createFromReadableStream(res.body);
      setPayloadRef.current?.(newPayload);
      debug('RSC navigation complete');
    } catch (e) {
      console.error('[Farm.js] RSC navigation failed:', e);
      // Fall back to full page navigation
      location.href = url;
    }
  }
  const rootElForHydrate = document.getElementById('root');
  if (!rootElForHydrate) {
    console.error('[Farm.js] #root element not found');
    return;
  }
  // Final cleanup pass before hydrate (in case DOM changed during async)
  while (rootElForHydrate.children.length > 1) rootElForHydrate.lastElementChild.remove();
  while (rootElForHydrate.nextElementSibling) rootElForHydrate.nextElementSibling.remove();
  debug('Hydrating application');
  globalThis.__FARM_RSC_HYDRATED = true;
  hydrateRoot(rootElForHydrate, React.createElement(BrowserRoot), {
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
