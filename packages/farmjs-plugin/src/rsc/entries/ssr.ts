import type { EntryContext } from "../types.js";

/**
 * Generates the SSR environment entry file.
 *
 * This entry file:
 * - Receives the RSC stream from the RSC environment
 * - Tees (duplicates) the stream - one copy for SSR, one for client hydration
 * - Deserializes the RSC stream back to React elements
 * - Renders those elements to HTML using React DOM's SSR
 * - Injects the RSC payload into the HTML so the client can hydrate
 */
export function generateSsrEntry(ctx: EntryContext): string {
  // No verbose logs; only [FARM] [PAGE] / [MIDDLEWARE] / [API] from the plugin
  const debugLog = `// Debug disabled`;

  return `
// Auto-generated SSR entry by @farmjs/plugin/rsc
// This file converts RSC stream to HTML for initial page loads

import React from 'react';
import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr';
import { injectRSCPayload } from 'rsc-html-stream/server';
import { renderToPipeableStream } from 'react-dom/server';

// Debug logging helper
function debug(...args) {
  ${debugLog}
}

/** Collect Node stream (from renderToPipeableStream) into a single string. Supports Suspense. */
function pipeableStreamToString(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    stream.on('error', reject);
  });
}

/**
 * Renders an RSC stream to HTML
 * Called by the RSC environment's handler
 */
export async function renderHTML(rscStream, options = {}) {
  debug('Starting SSR render');
  
  // Tee (duplicate) the stream:
  // - s1 is used for SSR rendering
  // - s2 is injected into HTML for client hydration
  const [s1, s2] = rscStream.tee();
  
  // Resolve payload once before streaming so we never suspend and never output
  // a shell + content (which would show two blocks, e.g. home below current page)
  const payload = await createFromReadableStream(s1);
  
  // Single root component
  function Root() {
    return payload.root;
  }
  
  // Get the bootstrap script that loads the client bundle (for hydration).
  // In dev: Farm sets globalThis.__FARM_VITE_RSC_LOAD_BOOTSTRAP__ or import.meta.viteRsc.
  // In production: __FARM_BOOTSTRAP_SCRIPT__ is replaced at build time by nitro-build from the manifest.
  const PROD_BOOTSTRAP = "__FARM_BOOTSTRAP_SCRIPT__";
  let bootstrap = '';
  try {
    if (typeof globalThis.__FARM_VITE_RSC_LOAD_BOOTSTRAP__ === 'function') {
      bootstrap = await globalThis.__FARM_VITE_RSC_LOAD_BOOTSTRAP__();
    } else if (typeof import.meta.viteRsc?.loadBootstrapScriptContent === 'function') {
      bootstrap = await import.meta.viteRsc.loadBootstrapScriptContent('index');
    }
  } catch (e) {
    debug('Could not load bootstrap script:', e);
  }
  if (!bootstrap && PROD_BOOTSTRAP !== "__FARM_BOOTSTRAP_SCRIPT__") bootstrap = PROD_BOOTSTRAP;
  
  // Use renderToPipeableStream (Node) so Suspense/client boundaries don't throw "suspended while responding to synchronous input".
  // Pipe to a buffer so we get one HTML string (no duplicate visible blocks).
  debug('Rendering to HTML stream (then buffering)');
  const { pipe } = renderToPipeableStream(React.createElement(Root), {
    ...(bootstrap && { bootstrapScriptContent: bootstrap }),
    formState: options.formState,
  });
  const { PassThrough } = await import('stream');
  const passThrough = new PassThrough();
  pipe(passThrough);
  const fullHtmlRaw = await pipeableStreamToString(passThrough);
  
  // In production, inject client CSS link (placeholder __FARM_CLIENT_CSS_HREF__ is replaced at build time by nitro-build).
  const CLIENT_CSS_HREF = "__FARM_CLIENT_CSS_HREF__";
  const shouldInjectCss = typeof CLIENT_CSS_HREF === "string" && CLIENT_CSS_HREF.length > 0 && CLIENT_CSS_HREF.indexOf("__FARM_CLIENT_CSS_HREF__") < 0;
  let fullHtml = fullHtmlRaw;
  if (shouldInjectCss && fullHtml.includes("</head>")) {
    fullHtml = fullHtml.replace("</head>", '<link rel="stylesheet" href="' + CLIENT_CSS_HREF + '"></head>');
  }
  ${ctx.actionsEnabled ? `// Ensure __viteRscCallServer is set before any module runs (fixes "is not a function" when form submits)
  if (fullHtml.includes("<body")) {
    fullHtml = fullHtml.replace(/<body[^>]*>/, function(m) {
      return m + "<script>(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error('Farm.js: server actions not ready'));}}})();</script>";
    });
  }
  ` : ""}
  debug('Injecting RSC payload into HTML');
  
  const streamFromHtml = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(fullHtml));
      controller.close();
    }
  });
  // Inject client script AFTER RSC payload so __FLIGHT_DATA is populated before the client bundle runs (fixes hydration + client nav)
  // PLACEHOLDER_STR is never patched so indexOf(PLACEHOLDER_STR) < 0 means CLIENT_ENTRY_HREF was patched to the real URL
  const PLACEHOLDER_STR = "__FARM_CLIENT_ENTRY_HREF__";
  const CLIENT_ENTRY_HREF = "__FARM_CLIENT_ENTRY_HREF__";
  let clientBuffer = "";
  let clientScriptInjected = false;
  const injectClientScriptStream = new TransformStream({
    transform(chunk, controller) {
      const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      if (!injectClientScriptInStream || clientScriptInjected) {
        controller.enqueue(chunk);
        return;
      }
      clientBuffer += str;
      if (clientBuffer.includes("</body></html>")) {
        const href = (typeof CLIENT_ENTRY_HREF === "string" && CLIENT_ENTRY_HREF.length > 0 && CLIENT_ENTRY_HREF.indexOf(PLACEHOLDER_STR) < 0) ? CLIENT_ENTRY_HREF : "";
        const out = href ? clientBuffer.replace("</body></html>", '<script type="module" src="' + href + '"></script></body></html>') : clientBuffer;
        controller.enqueue(typeof chunk === "string" ? out : new TextEncoder().encode(out));
        clientBuffer = "";
        clientScriptInjected = true;
      }
    },
    flush(controller) {
      if (clientBuffer) {
        controller.enqueue(typeof clientBuffer === "string" ? clientBuffer : new TextEncoder().encode(clientBuffer));
      }
    }
  });

  let out = streamFromHtml.pipeThrough(injectRSCPayload(s2));
  out = out.pipeThrough(injectClientScriptStream);
  return out;
}

// Enable HMR
if (import.meta.hot) {
  import.meta.hot.accept();
}
`;
}
