/**
 * Farm.js Client-Side Utilities
 *
 * These exports are for client-side use only.
 * They enable SPA navigation and client-side routing.
 */

export { Link } from "./link";
export type {
  LinkProps,
  PrefetchBehavior,
  LinkDefaultRoute,
  DefaultRoutePath,
  ExternalHref,
} from "./link";
export { useRouter } from "./router";
export { createAPIClient, createServerAPIClient } from "../api/client";
export type {
  APIClient,
  APIClientOptions,
  APIClientWithoutIntegrationsOptions,
  RouteAPIClient,
  ServerAPIClient,
  ServerAPIClientOptions,
  ServerAPIClientWithoutIntegrationsOptions,
} from "../api/client";
export { getRouter, navigateTo, prefetch, SPARouter } from "./spa-router";
export type { PageProps, LayoutProps, Metadata } from "../types";
