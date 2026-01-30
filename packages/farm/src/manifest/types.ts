/**
 * Build-time manifest types for SPA asset loading
 * Following the TanStack Start pattern: route → chunks/assets
 */

/**
 * A tag to be rendered in the HTML (script, link, meta, etc.)
 */
export interface RouterManagedTag {
  tag: "script" | "link" | "meta" | "style";
  attrs: Record<string, string>;
  children?: string;
}

/**
 * Manifest entry for a single route
 */
export interface RouteManifestEntry {
  /** Module path for dynamic import */
  modulePath: string;
  /** URLs of JS chunks to preload for this route */
  preloads?: string[];
  /** Tags to inject (scripts, stylesheets, etc.) */
  assets?: RouterManagedTag[];
  /** Whether this is a client component */
  isClientComponent?: boolean;
  /** Route pattern (for client-side matching) */
  pattern: string;
  /** Route segments for dynamic matching */
  segments: Array<{
    segment: string;
    isDynamic: boolean;
    isCatchAll?: boolean;
    isOptional?: boolean;
  }>;
}

/**
 * Layout manifest entry
 */
export interface LayoutManifestEntry {
  /** Module path for dynamic import */
  modulePath: string;
  /** Pattern this layout applies to */
  pattern: string;
  /** Preload URLs */
  preloads?: string[];
  /** Assets */
  assets?: RouterManagedTag[];
}

/**
 * The full app manifest
 */
export interface AppManifest {
  /** Client entry point URL */
  clientEntry?: string;
  /** Route manifests keyed by route pattern */
  routes: Record<string, RouteManifestEntry>;
  /** Layout manifests keyed by pattern */
  layouts: Record<string, LayoutManifestEntry>;
  /** Shared assets (global CSS, etc.) */
  sharedAssets?: RouterManagedTag[];
}

/**
 * Dehydrated manifest sent to client (filtered version)
 */
export interface DehydratedManifest {
  /** Current route's full entry */
  current: RouteManifestEntry;
  /** Current layouts */
  layouts: LayoutManifestEntry[];
  /** All routes (for client-side matching, minimal info) */
  routes: Record<string, Pick<RouteManifestEntry, "modulePath" | "pattern" | "segments" | "isClientComponent">>;
  /** All layouts (for navigation) */
  allLayouts: Record<string, Pick<LayoutManifestEntry, "modulePath" | "pattern">>;
  /** Shared assets */
  sharedAssets?: RouterManagedTag[];
  /** Client entry */
  clientEntry?: string;
}
