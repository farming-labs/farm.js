/**
 * Farm.js Client-Side Utilities
 *
 * These exports are for client-side use only.
 * They enable SPA navigation and client-side routing.
 */

export { Link } from "./link";
export { useRouter } from "./router";
export { createAPIClient } from "../api/client";
export { getRouter, navigateTo, prefetch, SPARouter } from "./spa-router";// Re-export types that are safe for client use
export type { PageProps, LayoutProps, Metadata } from "../types";