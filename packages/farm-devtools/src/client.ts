"use client";

import "@fontsource-variable/geist-mono/wght.css";

type DevtoolsWindow = Window & {
  __FARM_DEVTOOLS__?: { open(view?: string): void; close(): void; toggle(): void };
};

/** A small launcher only. The inspector and highlighter load when the iframe opens. */
export function startDevtoolsLauncher(runtimeWindow: DevtoolsWindow = window): { dispose(): void } {
  const document = runtimeWindow.document;
  const existing = document.querySelector("farm-devtools-launcher");
  existing?.remove();
  const host = document.createElement("farm-devtools-launcher");
  const shadow = host.attachShadow({ mode: "open", delegatesFocus: true });
  shadow.innerHTML = `<style>
    :host{--bg:#ffffff;--surface:#fafafa;--line:#d9d9d3;--text:#1b1b19;position:fixed;left:18px;bottom:18px;z-index:2147483645}
    button{box-sizing:border-box;display:flex;align-items:center;gap:9px;min-height:42px;margin:0;padding:0 12px;border:1px solid var(--line);border-radius:999px;background:var(--bg);color:var(--text);box-shadow:0 10px 32px rgb(0 0 0 / 16%);font:11px/1.45 "Geist Mono Variable","Geist Mono",ui-monospace,SFMono-Regular,Menlo,monospace;font-variation-settings:"wght" 620;letter-spacing:0;text-transform:uppercase;text-rendering:geometricPrecision;white-space:nowrap;cursor:pointer;-webkit-tap-highlight-color:transparent}
    @media(hover:hover){button:hover{background:var(--surface)}}
    button:active{background:var(--surface)}
    button:focus-visible{outline:2px solid #4074bd;outline-offset:3px}
    img{display:block;flex-shrink:0;width:16px;height:16px;filter:brightness(.3)}
    @media(prefers-color-scheme:dark){:host{--bg:#101010;--surface:#141414;--line:#353531;--text:#f0f0eb}img{filter:none}button:focus-visible{outline-color:#78a8ed}}
    @media(max-width:520px){:host{left:8px;bottom:8px}}
    @media(pointer:coarse){button{min-height:44px}}
  </style><button type="button" aria-label="Open Farm DevTools"><img src="/__farm/devtools/assets/logo.svg" alt=""><span>DevTools</span></button>`;
  const button = shadow.querySelector("button")!;
  button.onclick = () => runtimeWindow.__FARM_DEVTOOLS__?.open();
  document.body.append(host);
  return {
    dispose() {
      button.onclick = null;
      host.remove();
    },
  };
}
