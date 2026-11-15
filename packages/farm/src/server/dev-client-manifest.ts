import type { FarmClientRouteManifest } from "../routing/route-manager";
import { getRouteGroupScope, stripRouteGroups } from "../routing/route-groups";

/**
 * The development module that serves the whole client route manifest. A document inlines only
 * the entries its own page boots with and names this module; the browser imports it the first
 * time a navigation needs another route, as production keeps its route table out of the HTML.
 */
export const FARM_DEV_CLIENT_MANIFEST_MODULE = "/@farm/manifest";

export interface FarmDevSharedAsset {
  tag: string;
  attrs: Record<string, string>;
}

export interface FarmDevClientManifest {
  clientEntry: string;
  routes: Record<string, Record<string, unknown>>;
  layouts: Record<string, Record<string, unknown>>;
  slots: Array<Record<string, unknown>>;
  sharedAssets: FarmDevSharedAsset[];
  /** Set when the routes, layouts and slots are a subset: the module that has all of them. */
  module?: string;
}

/** What a document's page boots with: its route and the layouts the server rendered it in. */
export interface FarmDevClientManifestBoot {
  routePattern?: string | undefined;
  layoutPatterns: readonly string[];
}

/**
 * The client manifest development serves, keyed by pattern in route order. With `boot`, only
 * the entries that page reads before its first navigation: its route and layouts, the slots
 * they own, and every route with search options, which `Link` reads while it renders.
 */
export function createFarmDevClientManifest(
  manifest: FarmClientRouteManifest,
  options: { sharedAssets: FarmDevSharedAsset[]; boot?: FarmDevClientManifestBoot },
): FarmDevClientManifest {
  const { boot } = options;
  const layoutPatterns = boot ? new Set(boot.layoutPatterns) : undefined;
  const owners = boot
    ? new Set([...(boot.routePattern ? [boot.routePattern] : []), ...boot.layoutPatterns])
    : undefined;
  const clientManifest: FarmDevClientManifest = {
    clientEntry: "/@farm/client.js",
    routes: {},
    layouts: {},
    slots: [],
    sharedAssets: options.sharedAssets,
    ...(boot ? { module: FARM_DEV_CLIENT_MANIFEST_MODULE } : {}),
  };

  for (const route of manifest.routes) {
    if (boot && route.pattern !== boot.routePattern && !route.search) continue;
    clientManifest.routes[route.pattern] = {
      modulePath: route.modulePath,
      pattern: route.pattern,
      ...(route.directory ? { directory: route.directory } : {}),
      segments: route.segments,
      search: route.search,
      isClientComponent: route.isClientComponent,
      shouldHydrate: route.shouldHydrate,
      islandStrategy: route.islandStrategy,
      renderPlan: route.renderPlan,
      preloads: [route.modulePath],
      assets: [],
    };
  }

  for (const layout of manifest.layouts) {
    if (layoutPatterns && !layoutPatterns.has(layout.pattern)) continue;
    const groupScope = getRouteGroupScope(layout.pattern);
    clientManifest.layouts[layout.pattern] = {
      modulePath: layout.modulePath,
      pattern: layout.pattern,
      ...(groupScope ? { urlPattern: stripRouteGroups(layout.pattern), groupScope } : {}),
      shouldHydrate: layout.shouldHydrate,
      islandStrategy: layout.islandStrategy,
      // Islands mode: rebuilt from its server tree, so its module is never preloaded.
      ...(layout.serverTree ? { serverTree: true } : {}),
      preloads: layout.serverTree ? [] : [layout.modulePath],
      assets: [],
    };
  }

  for (const slot of manifest.slots ?? []) {
    if (owners && !owners.has(slot.ownerPattern)) continue;
    clientManifest.slots.push({ ...slot, preloads: [slot.modulePath], assets: [] });
  }

  return clientManifest;
}
