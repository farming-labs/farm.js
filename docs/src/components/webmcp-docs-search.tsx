"use client";

import { useEffect } from "react";

/**
 * Offers the docs search to browser agents through WebMCP. Browsers without a model context,
 * which is nearly all of them today, skip the import, so the tool costs them nothing.
 */
export function WebMCPDocsSearch() {
  useEffect(() => {
    if (!("modelContext" in document) && !("modelContext" in navigator)) return;
    let stop: (() => void) | undefined;
    let unmounted = false;
    import("../lib/webmcp-docs-search")
      .then(({ startDocsSearchTool }) => startDocsSearchTool())
      .then((cleanup) => {
        if (unmounted) cleanup();
        else stop = cleanup;
      })
      .catch((error: unknown) => console.warn("[farmjs.dev] WebMCP docs search failed", error));
    return () => {
      unmounted = true;
      stop?.();
    };
  }, []);
  return null;
}
