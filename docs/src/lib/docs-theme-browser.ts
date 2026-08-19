"use client";

import { createElement, useLayoutEffect } from "react";
import {
  BrowserDocsLayout as ProductionBrowserDocsLayout,
  type BrowserDocsLayoutProps,
} from "@farming-labs/theme-production/browser";

// The current provider supplies Farm's SPA navigation adapter. Keep the
// established production layout until the current theme restores visual
// parity with farmjs.dev. The wrapper below backports the title-host lifecycle
// fix from docs theme 0.2.106+ without replacing this pinned presentation.
export { BrowserRootProvider } from "@farming-labs/theme-runtime/browser";

function placeTitleDecorations(descriptionInBody: boolean): void {
  const container = document.getElementById("nd-page");
  const title = container?.querySelector("h1");
  const host = container?.querySelector(".fd-title-decorations-host");
  if (!container || !title || !host) return;

  let anchor: Element = title;

  if (descriptionInBody) {
    let sibling = title.nextElementSibling;
    while (sibling) {
      if (sibling === host || sibling.matches(".not-prose, .fd-title-decorations-host")) {
        sibling = sibling.nextElementSibling;
        continue;
      }

      if (sibling.matches("p")) anchor = sibling;
      break;
    }
  }

  if (anchor.nextElementSibling !== host) {
    anchor.insertAdjacentElement("afterend", host);
  }
}

export function BrowserDocsLayout(props: BrowserDocsLayoutProps) {
  useLayoutEffect(() => {
    const container = document.getElementById("nd-page");
    if (!container) return;

    const place = () => placeTitleDecorations(Boolean(props.descriptionInBody));
    const observer = new MutationObserver(place);

    place();
    observer.observe(container, { childList: true, subtree: true });
    const animationFrame = window.requestAnimationFrame(place);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      observer.disconnect();
    };
  }, [props.children, props.descriptionInBody]);

  return createElement(ProductionBrowserDocsLayout, props);
}
