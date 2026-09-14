import {
  FARM_DEVTOOLS_LAUNCH_PARAM,
  FARM_DEVTOOLS_PATH,
  type ResolvedFarmDevtoolsConfig,
} from "./devtools-config";

type ParsedShortcut = {
  key: string;
  alt: boolean;
  ctrl: boolean;
  meta: boolean;
  mod: boolean;
  shift: boolean;
};

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const tokens = shortcut
    .toLowerCase()
    .split("+")
    .map((token) => token.trim())
    .filter(Boolean);
  const key = tokens.find(
    (token) =>
      !["alt", "ctrl", "control", "meta", "cmd", "command", "mod", "shift"].includes(token),
  );

  if (!key) {
    return null;
  }

  return {
    key,
    alt: tokens.includes("alt"),
    ctrl: tokens.includes("ctrl") || tokens.includes("control"),
    meta: tokens.includes("meta") || tokens.includes("cmd") || tokens.includes("command"),
    mod: tokens.includes("mod"),
    shift: tokens.includes("shift"),
  };
}

export function generateFarmDevtoolsClientRuntime(config: ResolvedFarmDevtoolsConfig): string {
  if (!config.enabled) {
    return "";
  }

  const shortcut = config.shortcut ? parseShortcut(config.shortcut) : null;
  // Match the Hints launcher without depending on the optional hints plugin.
  const launcherStyles = `
    :host {
      all: initial;
      position: fixed;
      left: max(18px, env(safe-area-inset-left));
      bottom: max(18px, env(safe-area-inset-bottom));
      z-index: 2147483645;
      color-scheme: light dark;
    }
    :host([hidden]) { display: none; }
    button {
      --bg: #fbfbfa;
      --surface: #f3f3f0;
      --line: #d9d9d3;
      --text: #1b1b19;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 9px;
      min-height: 42px;
      padding: 0 14px 0 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--bg);
      color: var(--text);
      box-shadow: 0 10px 32px rgb(0 0 0 / 16%);
      font: 620 11px/1.45 "Geist Mono Variable", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
      letter-spacing: 0;
      text-transform: uppercase;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    button:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; }
    button:active { background: var(--surface); }
    .mark { display: grid; gap: 2px; width: 13px; }
    .mark i { display: block; height: 2px; background: currentColor; }
    .mark i:nth-child(2) { width: 9px; }
    .mark i:nth-child(3) { width: 5px; }
    @media (hover: hover) { button:hover { background: var(--surface); } }
    @media (prefers-color-scheme: dark) {
      button { --bg: #181817; --surface: #222220; --line: #353531; --text: #f0f0eb; }
    }
    @media (max-width: 520px) {
      :host { left: max(8px, env(safe-area-inset-left)); bottom: max(8px, env(safe-area-inset-bottom)); }
    }
  `;
  const overlayStyles = `
    #__farm_devtools_overlay__ {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: grid;
      place-items: center;
      padding: 20px;
      background: rgb(0 0 0 / 0);
      backdrop-filter: blur(0);
      opacity: 0;
      pointer-events: none;
      transition: background-color 150ms ease-out, backdrop-filter 150ms ease-out, opacity 150ms ease-out;
    }
    #__farm_devtools_overlay__[data-open="true"] {
      background: rgb(0 0 0 / 0.12);
      backdrop-filter: blur(1px);
      opacity: 1;
      pointer-events: auto;
    }
    #__farm_devtools_overlay__ > iframe {
      display: block;
      width: min(960px, calc(100vw - 40px));
      height: min(560px, calc(100dvh - 40px));
      border: 0;
      border-radius: 12px;
      background: transparent;
      box-shadow: 0 24px 80px rgb(0 0 0 / 0.48), 0 4px 18px rgb(0 0 0 / 0.24);
      transform: scale(0.985) translateY(4px);
      transition: transform 150ms ease-out;
    }
    #__farm_devtools_overlay__[data-open="true"] > iframe {
      transform: scale(1) translateY(0);
    }
    @media (max-width: 700px) {
      #__farm_devtools_overlay__ { padding: 8px; }
      #__farm_devtools_overlay__ > iframe {
        width: calc(100vw - 16px);
        height: calc(100dvh - 16px);
        border-radius: 10px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #__farm_devtools_overlay__, #__farm_devtools_overlay__ > iframe { transition: none; }
    }
  `;

  return `
(() => {
  const overlayId = "__farm_devtools_overlay__";
  const launcherId = "__farm_devtools_launcher__";
  const styleId = "__farm_devtools_overlay_styles__";
  const runtimeKey = "__FARM_DEVTOOLS_RUNTIME__";
  const launchParam = ${JSON.stringify(FARM_DEVTOOLS_LAUNCH_PARAM)};
  const devtoolsPath = ${JSON.stringify(FARM_DEVTOOLS_PATH)};
  const validViews = new Set(["overview", "routes", "api", "systems", "runtime", "raw"]);
  const shortcut = ${JSON.stringify(shortcut)};
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  let returnFocus = null;
  let closeTimer;
  let disposed = false;

  const matchesShortcut = (event) => {
    if (!shortcut || event.repeat) return false;
    const expectedCtrl = shortcut.ctrl || (shortcut.mod && !isMac);
    const expectedMeta = shortcut.meta || (shortcut.mod && isMac);
    if (
      Boolean(event.altKey) !== shortcut.alt ||
      Boolean(event.ctrlKey) !== expectedCtrl ||
      Boolean(event.metaKey) !== expectedMeta ||
      Boolean(event.shiftKey) !== shortcut.shift
    ) return false;

    if (shortcut.key === "." || shortcut.key === "period") return event.code === "Period";
    if (shortcut.key === "," || shortcut.key === "comma") return event.code === "Comma";
    if (shortcut.key === "/" || shortcut.key === "slash") return event.code === "Slash";
    return String(event.key || "").toLowerCase() === shortcut.key;
  };

  const ensureStyles = () => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = ${JSON.stringify(overlayStyles)};
    document.head.appendChild(style);
  };

  const close = () => {
    const overlay = document.getElementById(overlayId);
    if (!overlay || overlay.dataset.open === "false") return;
    const focusTarget = returnFocus;
    returnFocus = null;
    overlay.dataset.open = "false";
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      overlay.remove();
      const launcher = document.getElementById(launcherId);
      if (launcher) launcher.hidden = false;
      focusTarget?.focus?.();
    }, 160);
  };

  const open = (view = "overview") => {
    if (disposed || document.getElementById(overlayId)) return;
    ensureStyles();
    returnFocus = document.activeElement?.shadowRoot?.activeElement || document.activeElement;
    const launcher = document.getElementById(launcherId);
    if (launcher) launcher.hidden = true;
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("aria-label", "Farm.js DevTools overlay");
    const frame = document.createElement("iframe");
    const resolvedView = validViews.has(view) ? view : "overview";
    frame.src = devtoolsPath + "?embedded=1" + (resolvedView === "overview" ? "" : "#" + resolvedView);
    frame.title = "Farm.js DevTools";
    frame.addEventListener("load", () => frame.contentWindow?.focus(), { once: true });
    overlay.appendChild(frame);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) close();
    });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      if (!disposed && overlay.isConnected && overlay.dataset.open !== "false") {
        overlay.dataset.open = "true";
      }
    });
  };

  const toggle = () => {
    if (document.getElementById(overlayId)) close();
    else open();
  };

  const onKeydown = (event) => {
    if (event.key === "Escape" && document.getElementById(overlayId)) {
      event.preventDefault();
      close();
      return;
    }
    if (!matchesShortcut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  const onMessage = (event) => {
    if (event.origin !== location.origin) return;
    const frame = document.querySelector("#" + overlayId + " > iframe");
    if (!frame || event.source !== frame.contentWindow) return;
    if (event.data?.type === "farm:devtools:close") close();
    if (event.data?.type === "farm:devtools:keydown" && matchesShortcut(event.data.event || {})) close();
  };

  const attachLauncher = () => {
    if (disposed || document.getElementById(launcherId)) return;
    const host = document.createElement("farm-devtools");
    host.id = launcherId;
    host.hidden = Boolean(document.getElementById(overlayId));
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = ${JSON.stringify(launcherStyles)};
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Open Farm DevTools");
    button.setAttribute("aria-haspopup", "dialog");
    button.innerHTML = '<span class="mark" aria-hidden="true"><i></i><i></i><i></i></span><span>DevTools</span>';
    button.addEventListener("click", () => open());
    shadow.append(style, button);
    document.body.appendChild(host);
  };

  const launch = () => requestAnimationFrame(() => {
    if (!disposed) open(launchView);
  });
  window[runtimeKey]?.dispose?.();
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("message", onMessage);
  window[runtimeKey] = {
    dispose() {
      disposed = true;
      window.clearTimeout(closeTimer);
      document.removeEventListener("DOMContentLoaded", attachLauncher);
      document.removeEventListener("DOMContentLoaded", launch);
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("message", onMessage);
      document.getElementById(launcherId)?.remove();
      document.getElementById(overlayId)?.remove();
    },
  };
  window.__FARM_DEVTOOLS__ = { open, close, toggle };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attachLauncher, { once: true });
  } else {
    attachLauncher();
  }

  const launchUrl = new URL(location.href);
  const launchRequest = launchUrl.searchParams.get(launchParam);
  let launchView = "overview";
  if (launchRequest !== null) {
    const hashView = launchUrl.hash.slice(1);
    launchView = validViews.has(launchRequest)
      ? launchRequest
      : validViews.has(hashView)
        ? hashView
        : "overview";
    launchUrl.searchParams.delete(launchParam);
    if (validViews.has(hashView)) launchUrl.hash = "";
    history.replaceState(
      history.state,
      "",
      launchUrl.pathname + launchUrl.search + launchUrl.hash,
    );
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", launch, { once: true });
    } else {
      launch();
    }
  }
})();
`;
}
