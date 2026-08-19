"use client";

// The current provider supplies Farm's SPA navigation adapter. Keep the
// established production layout until the current theme restores visual
// parity with farmjs.dev.
export { BrowserRootProvider } from "@farming-labs/theme-runtime/browser";
export { BrowserDocsLayout } from "@farming-labs/theme-production/browser";
