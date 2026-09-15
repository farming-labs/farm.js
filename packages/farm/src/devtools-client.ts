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
  const overlayStyles = `
    #__farm_devtools_overlay__ {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: grid;
      place-items: center;
      box-sizing: border-box;
      padding: 20px;
      background: rgb(0 0 0 / 0);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      overscroll-behavior: none;
      isolation: isolate;
      opacity: 0;
      pointer-events: none;
      transition: opacity 150ms ease-out;
    }
    #__farm_devtools_overlay__[data-open="true"] {
      background: rgb(0 0 0 / 0.32);
      opacity: 1;
      pointer-events: auto;
    }
    #__farm_devtools_overlay__ > iframe {
      display: block;
      width: min(1100px, calc(100vw - 48px));
      height: min(720px, calc(100dvh - 48px));
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
        border-radius: 12px;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      #__farm_devtools_overlay__, #__farm_devtools_overlay__ > iframe { transition: none; }
    }
  `;

  return `
(() => {
  const overlayId = "__farm_devtools_overlay__";
  const styleId = "__farm_devtools_overlay_styles__";
  const runtimeKey = "__FARM_DEVTOOLS_RUNTIME__";
  const launchParam = ${JSON.stringify(FARM_DEVTOOLS_LAUNCH_PARAM)};
  const devtoolsPath = ${JSON.stringify(FARM_DEVTOOLS_PATH)};
  const validViews = new Set(["overview", "routes", "api", "systems", "runtime", "raw"]);
  const shortcut = ${JSON.stringify(shortcut)};
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  let returnFocus = null;
  let restorePage = null;
  let closeTimer = null;

  const lockPage = () => {
    const styles = [];
    for (const element of [document.documentElement, document.body]) {
      for (const [property, value] of [["overflow-x", "hidden"], ["overflow-y", "hidden"], ["overscroll-behavior", "none"]]) {
        const previous = element.style.getPropertyValue(property);
        const priority = element.style.getPropertyPriority(property);
        element.style.setProperty(property, value, "important");
        styles.push({ element, property, value, previous, priority });
      }
    }
    return () => {
      for (const { element, property, value, previous, priority } of styles) {
        // Do not overwrite a newer style set by the application while the panel was open.
        if (element.style.getPropertyValue(property) !== value || element.style.getPropertyPriority(property) !== "important") continue;
        if (previous) element.style.setProperty(property, previous, priority);
        else element.style.removeProperty(property);
      }
    };
  };

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

  const finishClose = () => {
    if (closeTimer !== null) window.clearTimeout(closeTimer);
    closeTimer = null;
    const overlay = document.getElementById(overlayId);
    overlay?.remove();
    restorePage?.();
    restorePage = null;
    const focusTarget = returnFocus;
    returnFocus = null;
    focusTarget?.focus?.({ preventScroll: true });
  };

  const close = () => {
    const overlay = document.getElementById(overlayId);
    if (!overlay || closeTimer !== null) return;
    overlay.dataset.open = "false";
    closeTimer = window.setTimeout(finishClose, 160);
  };

  const open = (view = "overview") => {
    if (closeTimer !== null) finishClose();
    if (document.getElementById(overlayId)) return;
    ensureStyles();
    returnFocus = document.activeElement;
    restorePage = lockPage();
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
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
    overlay.addEventListener("wheel", (event) => event.preventDefault(), { passive: false });
    overlay.addEventListener("touchmove", (event) => event.preventDefault(), { passive: false });
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      if (overlay.isConnected && closeTimer === null) overlay.dataset.open = "true";
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

  window[runtimeKey]?.dispose?.();
  window.addEventListener("keydown", onKeydown, true);
  window.addEventListener("message", onMessage);
  window[runtimeKey] = {
    dispose() {
      finishClose();
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("message", onMessage);
    },
  };
  window.__FARM_DEVTOOLS__ = { open, close, toggle };

  const launchUrl = new URL(location.href);
  const launchRequest = launchUrl.searchParams.get(launchParam);
  if (launchRequest !== null) {
    const hashView = launchUrl.hash.slice(1);
    const launchView = validViews.has(launchRequest)
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
    const launch = () => requestAnimationFrame(() => open(launchView));
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", launch, { once: true });
    } else {
      launch();
    }
  }
})();
`;
}
