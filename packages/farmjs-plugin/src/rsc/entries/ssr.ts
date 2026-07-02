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
  const debugLog = `// Debug disabled`;
  const routesDir = ctx.routesDir === undefined ? "app" : ctx.routesDir.trim();
  const routesPath = routesDir ? `/${routesDir}` : "";
  const globalsCssPath = `/${ctx.srcDir}${routesPath}/globals.css`;

  return `
import React from 'react';
import { createFromReadableStream } from '@vitejs/plugin-rsc/ssr';
import { injectRSCPayload } from 'rsc-html-stream/server';
import { renderToPipeableStream } from 'react-dom/server';

function debug(...args) {
  ${debugLog}
}

const DEV_GLOBAL_CSS_HREF = ${JSON.stringify(globalsCssPath)};
const CLIENT_CSS_HREF = "__FARM_CLIENT_CSS_HREF__";
const PLACEHOLDER_CSS_HREF = "__FARM_CLIENT_CSS_HREF__";
const resolvedCssHref =
  typeof CLIENT_CSS_HREF === "string" &&
  CLIENT_CSS_HREF.length > 0 &&
  CLIENT_CSS_HREF.indexOf(PLACEHOLDER_CSS_HREF) < 0
    ? CLIENT_CSS_HREF
    : DEV_GLOBAL_CSS_HREF;

function escapeHtmlAttribute(value) {
  return String(value).replace(/[&"]/g, (char) => (char === '&' ? '&amp;' : '&quot;'));
}

const cssLinkTag = resolvedCssHref
  ? '<link rel="stylesheet" href="' + escapeHtmlAttribute(resolvedCssHref) + '" as="style" data-precedence="default">'
  : '';

function injectIntoHeadStream(tag) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const marker = '</head>';
  let buffer = '';
  let injected = false;

  return new TransformStream({
    transform(chunk, controller) {
      const str = typeof chunk === "string" ? chunk : decoder.decode(chunk);
      if (injected || !tag) {
        controller.enqueue(typeof chunk === "string" ? encoder.encode(str) : chunk);
        return;
      }

      buffer += str;
      const index = buffer.indexOf(marker);
      if (index >= 0) {
        const before = buffer.slice(0, index);
        const after = buffer.slice(index + marker.length);
        controller.enqueue(encoder.encode(before + tag + marker + after));
        buffer = '';
        injected = true;
        return;
      }

      if (buffer.length > marker.length) {
        controller.enqueue(encoder.encode(buffer.slice(0, buffer.length - marker.length)));
        buffer = buffer.slice(-marker.length);
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(encoder.encode(buffer));
    },
  });
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
 * @param { { payload, rscStream } | ReadableStream } firstArg - Either { payload, rscStream } for initial load (stream tree so loading.tsx shows first) or legacy rscStream only
 */
export async function renderHTML(firstArg, options = {}) {
  debug('Starting SSR render');
  
  const hasPayload = firstArg && typeof firstArg === 'object' && firstArg.payload != null && firstArg.rscStream != null;
  const rscStream = hasPayload ? firstArg.rscStream : firstArg;
  const [s1, s2] = rscStream.tee();
  
  // Always deserialize the RSC stream before SSR. Rendering the raw payload directly
  // calls client references on the server (for example, a "use client" Counter).
  const payload = await createFromReadableStream(s1);
  const rootElement = payload.root;
  
  function Root() {
    return rootElement;
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
  
  // Use renderToPipeableStream so Suspense streams: fallback (loading.tsx) first, then resolved content.
  const { pipe } = renderToPipeableStream(React.createElement(Root), {
    ...(bootstrap && { bootstrapScriptContent: bootstrap }),
    formState: options.formState,
  });
  const { PassThrough, Readable } = await import('stream');
  const passThrough = new PassThrough();
  pipe(passThrough);

  const CLIENT_ENTRY_HREF = "__FARM_CLIENT_ENTRY_HREF__";
  const PLACEHOLDER_STR = "__FARM_CLIENT_ENTRY_HREF__";
  const injectClientScriptInStream = typeof CLIENT_ENTRY_HREF === "string" && CLIENT_ENTRY_HREF.length > 0 && CLIENT_ENTRY_HREF.indexOf(PLACEHOLDER_STR) < 0;
  const clientScriptTag = injectClientScriptInStream ? '<script type="module" src="' + CLIENT_ENTRY_HREF + '"></script>' : '';

  if (hasPayload) {
    // Stream HTML to the client while preserving the RSC payload for hydration.
    debug('Streaming HTML (loading fallback then content)');
    const BODY_HTML_END = '</body></html>';
    const TAG_LEN = BODY_HTML_END.length;
    const encoder = new TextEncoder();
    let streamBuf = '';
    const streamingClientScriptInjector = new TransformStream({
      transform(chunk, controller) {
        const str = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
        if (!injectClientScriptInStream || !clientScriptTag) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(str) : chunk);
          return;
        }
        streamBuf += str;
        while (streamBuf.length > TAG_LEN) {
          const tail = streamBuf.slice(-TAG_LEN);
          if (tail === BODY_HTML_END) {
            const before = streamBuf.slice(0, streamBuf.length - TAG_LEN);
            controller.enqueue(encoder.encode(before + clientScriptTag + BODY_HTML_END));
            streamBuf = '';
            return;
          }
          controller.enqueue(encoder.encode(streamBuf.slice(0, streamBuf.length - TAG_LEN)));
          streamBuf = streamBuf.slice(-TAG_LEN);
        }
      },
      flush(controller) {
        if (streamBuf) controller.enqueue(encoder.encode(streamBuf));
      }
    });
    const webStream = typeof Readable.toWeb === 'function'
      ? Readable.toWeb(passThrough)
      : new ReadableStream({
          start(controller) {
            passThrough.on('data', (c) => controller.enqueue(c instanceof Buffer ? c : new TextEncoder().encode(String(c))));
            passThrough.on('end', () => controller.close());
            passThrough.on('error', (e) => controller.error(e));
          }
        });
    let out = webStream.pipeThrough(injectIntoHeadStream(cssLinkTag));
    out = out.pipeThrough(injectRSCPayload(s2));
    out = out.pipeThrough(streamingClientScriptInjector);
    return out;
  }

  // Legacy path: buffer full HTML then send (no loading streaming)
  debug('Rendering to HTML stream (then buffering)');
  const fullHtmlRaw = await pipeableStreamToString(passThrough);
  let fullHtml = fullHtmlRaw;
  if (cssLinkTag && fullHtml.includes("</head>")) {
    fullHtml = fullHtml.replace("</head>", cssLinkTag + "</head>");
  }
  ${
    ctx.actionsEnabled
      ? `// Ensure __viteRscCallServer is set before any module runs (fixes "is not a function" when form submits)
  if (fullHtml.includes("<body")) {
    fullHtml = fullHtml.replace(/<body[^>]*>/, function(m) {
      return m + "<script>(function(){if(typeof globalThis.__viteRscCallServer!=='function'){globalThis.__viteRscCallServer=function(){return Promise.reject(new Error('Farm.js: server actions not ready'));}}})();</script>";
    });
  }
  `
      : ""
  }
  debug('Injecting RSC payload into HTML');
  const streamFromHtml = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(fullHtml));
      controller.close();
    }
  });
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
        controller.enqueue(new TextEncoder().encode(out));
        clientBuffer = "";
        clientScriptInjected = true;
      }
    },
    flush(controller) {
      if (clientBuffer) {
        controller.enqueue(new TextEncoder().encode(clientBuffer));
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
