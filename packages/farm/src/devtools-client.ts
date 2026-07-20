import type { ResolvedFarmDevtoolsConfig } from "./devtools-config";

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
      ![
        "alt",
        "ctrl",
        "control",
        "meta",
        "cmd",
        "command",
        "mod",
        "shift",
      ].includes(token),
  );

  if (!key) {
    return null;
  }

  return {
    key,
    alt: tokens.includes("alt"),
    ctrl: tokens.includes("ctrl") || tokens.includes("control"),
    meta:
      tokens.includes("meta") ||
      tokens.includes("cmd") ||
      tokens.includes("command"),
    mod: tokens.includes("mod"),
    shift: tokens.includes("shift"),
  };
}

export function generateFarmDevtoolsClientRuntime(
  config: ResolvedFarmDevtoolsConfig,
): string {
  if (!config.enabled) {
    return "";
  }

  const shortcut = config.shortcut ? parseShortcut(config.shortcut) : null;
  const overlayStyles = `
    #__farm_devtools_overlay__ {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      overflow: hidden;
      background: rgb(0 0 0 / 0);
      backdrop-filter: blur(0);
      opacity: 0;
      transition: background-color 150ms ease-out, backdrop-filter 150ms ease-out, opacity 150ms ease-out;
    }
    #__farm_devtools_overlay__[data-open="true"] {
      background: rgb(0 0 0 / 0.36);
      backdrop-filter: blur(3px);
      opacity: 1;
    }
    #__farm_devtools_overlay__ > iframe {
      display: block;
      width: 100%;
      height: 100%;
      border: 0;
      background: transparent;
    }
    @media (prefers-reduced-motion: reduce) {
      #__farm_devtools_overlay__ { transition: none; }
    }
  `;

  return `
(() => {
  const overlayId = "__farm_devtools_overlay__";
  const styleId = "__farm_devtools_overlay_styles__";
  const runtimeKey = "__FARM_DEVTOOLS_RUNTIME__";
  const shortcut = ${JSON.stringify(shortcut)};
  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  let returnFocus = null;

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
    if (!overlay) return;
    const focusTarget = returnFocus;
    returnFocus = null;
    overlay.dataset.open = "false";
    window.setTimeout(() => {
      overlay.remove();
      focusTarget?.focus?.();
    }, 160);
  };

  const open = () => {
    if (document.getElementById(overlayId)) return;
    ensureStyles();
    returnFocus = document.activeElement;
    const overlay = document.createElement("div");
    overlay.id = overlayId;
    overlay.setAttribute("aria-label", "Farm.js DevTools overlay");
    const frame = document.createElement("iframe");
    frame.src = "/__farm/devtools?embedded=1";
    frame.title = "Farm.js DevTools";
    frame.addEventListener("load", () => frame.contentWindow?.focus(), { once: true });
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.dataset.open = "true";
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
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("message", onMessage);
    },
  };
  window.__FARM_DEVTOOLS__ = { open, close, toggle };
})();
`;
}
