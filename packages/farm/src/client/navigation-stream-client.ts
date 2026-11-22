/**
 * The browser's reader for a streamed navigation (islands mode, `F-Stream: flush`), as source. The
 * production client entry (nitro/universal-build.ts) and the `farm dev` client entry (vite.ts) both
 * include it, so the two split a navigation into its shell and flushes the same way.
 */
export const FARM_NAVIGATION_STREAM_READER_SOURCE = `// Reads a streamed navigation (F-Stream) up to the end of React's shell. \`next\` then resolves
// with each later flush as it ends, and null at the end; a document without a marker is all shell.
// The marker carries the random token the server sent in the F-Flush header, so page content
// cannot forge a boundary; a response without a valid token is all shell.
async function readFarmNavigationStream(body, flushToken) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const marker = typeof flushToken === "string" && /^[0-9a-f]{32}$/.test(flushToken)
    ? "<!--farm-flush:" + flushToken + "-->"
    : "";
  let text = "";
  let done = false;
  const next = async function() {
    for (;;) {
      const at = marker ? text.indexOf(marker) : -1;
      if (at !== -1) {
        const flush = text.slice(0, at);
        text = text.slice(at + marker.length);
        return flush;
      }
      if (done) {
        const flush = text;
        text = "";
        return flush ? flush : null;
      }
      const result = await reader.read();
      if (result.done) {
        done = true;
        text += decoder.decode();
      } else {
        text += decoder.decode(result.value, { stream: true });
      }
    }
  };
  const shell = await next();
  if (done && !text) return { shell: shell || "" };
  return {
    shell: shell,
    next: next,
    cancel: function() { reader.cancel().catch(function() {}); },
  };
}`;

/**
 * The routers' half of the boot script's early request (islands-boot.ts, `FarmEarlyNavigation`),
 * as source, included by both client entries in islands mode beside the stream reader.
 */
export const FARM_EARLY_NAVIGATION_SOURCE = `// The request the boot script sent for a link clicked before the router ran (islands-boot.ts).
// The next navigation request takes its response when it is the same request, and aborts it
// otherwise. The held island values may differ: a response for fewer of them carries more values,
// which fits any page. As with a prefetched page, a response sent over 30 seconds ago is not used.
function takeFarmEarlyNavigation(url, headers, signal) {
  const early = window.__FARM_EARLY_NAVIGATION__;
  if (!early) return null;
  window.__FARM_EARLY_NAVIGATION__ = undefined;
  const target = new URL(url, window.location.href);
  const requested = new URL(early.url, window.location.href);
  target.hash = "";
  requested.hash = "";
  let same = target.href === requested.href && Date.now() - early.at <= 30000 && !(signal && signal.aborted);
  const names = new Set(Object.keys(early.headers));
  headers.forEach(function(value, name) { names.add(name); });
  names.forEach(function(name) {
    const sent = Object.prototype.hasOwnProperty.call(early.headers, name) ? early.headers[name] : null;
    if (name !== "f-values" && sent !== headers.get(name)) same = false;
  });
  if (!same) {
    early.controller.abort();
    return null;
  }
  if (signal) signal.addEventListener("abort", function() { early.controller.abort(); }, { once: true });
  return early.response;
}`;
