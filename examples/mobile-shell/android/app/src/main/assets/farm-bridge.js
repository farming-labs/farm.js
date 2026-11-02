// Injected by the shell at document start, for the app's origin only.
// Defines window.__farmBridge: request ids, Promise resolution from native
// (evaluateJavascript -> __farmBridge._resolve), and visit messages that hand
// navigation to the native navigator instead of the in-page router.
(() => {
  if (window.__farmBridge) return;

  const port = window.FarmNative;
  if (!port) return;

  const plugins = __FARM_PLUGINS__;
  const pending = new Map();
  let seq = 0;
  let router;
  let navigateInPlace;

  const post = (message) => port.postMessage(JSON.stringify(message));

  const markPlatform = () => {
    const html = document.documentElement;
    if (!html) return false;
    html.dataset.platform = "android";
    return true;
  };
  if (!markPlatform()) {
    const observer = new MutationObserver(() => {
      if (markPlatform()) observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }

  const bridge = {
    platform: "android",
    plugins,
    has: (name) => plugins.includes(name),

    call(plugin, method, args) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        post({ type: "call", id, plugin, method, args: args ?? {} });
      });
    },

    _resolve(id, ok, value) {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      if (ok) entry.resolve(value);
      else {
        const error = new Error((value && value.message) || "Native call failed");
        error.code = value && value.code;
        entry.reject(error);
      }
    },

    // Hand a navigation to the native navigator.
    visit(href, options) {
      const url = new URL(href, location.href);
      post({ type: "visit", url: url.href, action: options && options.replace ? "replace" : "advance" });
    },

    // Called by native on a pooled WebView: render `href` with the Farm client
    // router that is already running, then report back.
    render(href, token) {
      const started = performance.now();
      const done = () =>
        requestAnimationFrame(() =>
          post({
            type: "rendered",
            token,
            url: location.href,
            title: document.title,
            ms: performance.now() - started,
          }),
        );
      if (!navigateInPlace) {
        post({ type: "error", token, url: href, message: "Farm router is not ready" });
        return;
      }
      const target = new URL(href, location.href);
      const refresh = target.pathname === location.pathname && target.search === location.search;
      // Native falls back to a document load when the in-place render fails.
      navigateInPlace(target.href, { replace: true, scroll: false, refresh }).then(done, (error) =>
        post({ type: "error", token, url: target.href, message: String(error && error.message) }),
      );
    },

    // Re-render the current route from the server (used when a modal closes).
    refresh() {
      if (router && typeof router.refresh === "function") return router.refresh();
      location.reload();
    },
  };

  // Farm installs its SPA router on window.__FARM_SPA_ROUTER__. Wrap navigate()
  // so Link taps and navigateTo() calls become visits. Same-URL navigations
  // (hash changes, refresh) stay in the page.
  const wrap = (instance) => {
    if (!instance || typeof instance.navigate !== "function" || instance.__farmShell) return;
    const original = instance.navigate.bind(instance);
    navigateInPlace = original;
    instance.__farmShell = true;
    instance.navigate = (href, options = {}) => {
      const url = new URL(href, location.href);
      const samePage = url.pathname === location.pathname && url.search === location.search;
      if (options.refresh || samePage) return original(href, options);
      bridge.visit(url.href, options);
      return Promise.resolve();
    };
    post({ type: "router-ready", url: location.href, title: document.title });
  };

  Object.defineProperty(window, "__FARM_SPA_ROUTER__", {
    configurable: true,
    get: () => router,
    set: (value) => {
      router = value;
      wrap(value);
    },
  });

  // Titles change after client renders; keep the native bar in sync.
  const reportTitle = () => post({ type: "title", title: document.title, url: location.href });
  document.addEventListener("DOMContentLoaded", () => {
    reportTitle();
    const head = document.querySelector("head");
    if (head) new MutationObserver(reportTitle).observe(head, { subtree: true, childList: true, characterData: true });
  });

  window.__farmBridge = bridge;
})();
