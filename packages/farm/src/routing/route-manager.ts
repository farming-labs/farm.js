import { loadFarmDevModule } from "../dev-module";
import type {
  FarmConfig,
  ParsedRoute,
  RouteModule,
  LayoutModule,
  SSGCollectionResult,
} from "../types";
import {
  parseRoutePath,
  matchRoute,
  matchRouteParts,
  matchRoutePrefix,
  matchRoutePrefixParts,
  splitRoutePath,
  resolveAppPath,
  globFiles,
  logger,
  toRootRelativeUrlPath,
  toViteModuleId,
} from "../utils";
import { collectSSGPages, resolveRouteRenderingConfigFromFile } from "../ssg";
import type {
  ProgrammaticPageRoute,
  ProgrammaticLayoutRoute,
  ProgrammaticRedirectRoute,
  ProgrammaticRouteSearchClientOptions,
} from "../routes";
import {
  createProgrammaticRouteModuleId,
  getProgrammaticRouteSearchClientOptions,
  parseProgrammaticRoutePath,
} from "../routes-shared";
import { loadProgrammaticRouteManifests } from "../routes.server";
import {
  createFarmMarkdownRouteModuleFromFile,
  isFarmMarkdownPageFile,
  loadFarmMdxComponents,
  resolveFarmMdxComponentsModulePath,
  resolveMdxConfig,
} from "../app-markdown";
import path from "path";
import type { ViteDevServer } from "vite";
import { toFileModuleUrl } from "../utils/file-module";
import {
  applyFarmServerLayouts,
  enforceFarmIsolatedHydrationRouteBudget,
  getClientModuleHydrationPlan,
  createMarkdownPageHydrationPlanner,
  getFarmClientHydrationPlanOptions,
  usesFarmServerTree,
  getClientModuleMetadata,
  resolveFarmIsolatedClientHydrationMode,
  type IsolatedClientBoundaryReference,
} from "../utils/client-component";
import { getIntegrationProviders } from "../integrations";
import type { MetadataImageKind } from "../metadata";
import type { FarmIslandStrategy } from "../island";
import type { FarmServerRendererRuntime } from "../renderer";
import { createFarmRouteRenderPlan, type FarmRouteRenderPlan } from "../navigation/render-plan";
import { getFarmSourceRoots, type FarmSourceRoot } from "../layers";
import {
  inspectStaticMetadataImage,
  isStaticMetadataImageFile,
  type StaticMetadataImageInfo,
} from "../static-metadata-image";
import {
  getFarmRouteRuntimeConfig,
  mergeFarmRouteRuntimeConfigs,
  normalizeFarmRouteRuntimeConfig,
  resolveFarmRouteRuleRuntimeConfig,
  resolveFarmRouteRuntimeConfig,
  type ResolvedFarmRouteRuntimeConfig,
} from "../route-runtime";
import {
  localizeFarmHref,
  localizeFarmPathname,
  resolveFarmLocalePath,
  stripFarmLocaleFromPathname,
} from "../i18n/routing";
import type { ResolvedFarmI18nConfig } from "../i18n/types";
import { stripFarmBasePath } from "../base-path";
import { appendFarmRedirectQuery } from "../redirect-query";
import { createRouteSlotContainerId, parseRouteSlotFile } from "./route-slots";
import {
  createRouteDirectoryPattern,
  formatRouteSegment,
  getRouteDirectoryDepth,
  getRouteGroupScope,
  isInRouteGroupScope,
  routeBoundaryCoversDirectory,
} from "./route-groups";
import { getFarmRendererComponentExtensions } from "../renderer";
import type { ApplicationMetadataRouteKind } from "../metadata-route";
import {
  AmbiguousRouteError,
  assertUniqueRouteParameters,
  compareRouteSpecificity,
  getRoutePatternShape,
  type RouteSegmentSpecificity,
} from "./specificity";

interface RouteEntry {
  route: ParsedRoute;
  modulePath: string;
  markdownSourcePath?: string;
  /**
   * A page's URL pattern. Layouts, loading and error boundaries use their app
   * directory instead, route groups included (`/(auth)`), because a group adds
   * no URL segment and two of them can share one URL.
   */
  pattern: string;
  /** A page's directory pattern, set only when it differs from `pattern` (route groups). */
  directory?: string;
  source?: "file" | "programmatic";
  sourceRoot: string;
}

/** A layout in nesting order, with the group directory that confines it, if any. */
interface OrderedLayoutEntry {
  entry: RouteEntry;
  groupScope: string | null;
}

function getRouteEntryDirectory(entry: RouteEntry): string {
  return entry.directory ?? entry.pattern;
}

export interface RouteSlotEntry extends RouteEntry {
  name: string;
  ownerPattern: string;
  /**
   * The owning layout's pattern when route groups make it differ from
   * `ownerPattern` (a URL pattern); slots render into the layout with this pattern.
   */
  ownerDirectory?: string;
  interception: boolean;
  fallback: boolean;
  containerId: string;
}

export interface MatchedRouteSlot {
  name: string;
  ownerPattern: string;
  /** See `RouteSlotEntry.ownerDirectory`. */
  ownerDirectory?: string;
  containerId: string;
  interception: boolean;
  fallback: boolean;
  route: RouteSlotEntry;
  params: Record<string, string>;
}

export interface FarmClientRouteManifest {
  routes: Array<{
    pattern: string;
    /** The page's directory pattern when route groups make it differ from `pattern`. */
    directory?: string;
    modulePath: string;
    shouldHydrate: boolean;
    isClientComponent: boolean;
    islandStrategy: FarmIslandStrategy | null;
    hasIsolatedClientBoundaries?: true;
    isolatedBoundaries?: IsolatedClientBoundaryReference[];
    /** The async page renders as a server tree inside its hydrating layout's root. */
    serverTree?: true;
    renderPlan: FarmRouteRenderPlan;
    suppressedAsyncHydration?: true;
    /** Why an async page's client components could not become islands. */
    suppressedAsyncHydrationReason?: string;
    search?: ProgrammaticRouteSearchClientOptions;
    segments: Array<{
      segment: string;
      isDynamic: boolean;
      isCatchAll?: boolean;
      isOptional?: boolean;
    }>;
  }>;
  layouts: Array<{
    pattern: string;
    modulePath: string;
    shouldHydrate: boolean;
    isClientComponent: boolean;
    islandStrategy: FarmIslandStrategy | null;
    hasIsolatedClientBoundaries?: true;
    isolatedBoundaries?: IsolatedClientBoundaryReference[];
    suppressedAsyncHydration?: true;
    /** Why an async layout's client-side hydration could not become islands. */
    suppressedAsyncHydrationReason?: string;
  }>;
  slots: Array<{
    name: string;
    ownerPattern: string;
    pattern: string;
    modulePath: string;
    containerId: string;
    interception: boolean;
    fallback: boolean;
    shouldHydrate: boolean;
    isClientComponent: boolean;
    segments: RouteEntry["route"]["segments"];
  }>;
}

export function shouldSuggestStaticRenderingForI18n(
  i18n: Pick<ResolvedFarmI18nConfig, "routing" | "detection"> | undefined,
): boolean {
  return (
    !i18n ||
    i18n.routing === "prefix-always" ||
    (i18n.routing === "prefix-except-default" && i18n.detection.every((signal) => signal === "url"))
  );
}

interface MetadataImageEntry extends RouteEntry {
  kind: MetadataImageKind;
  fileName: "opengraph-image" | "twitter-image";
  sourceType: "module" | "static";
  staticInfo?: StaticMetadataImageInfo;
}

export interface ApplicationMetadataRouteEntry extends RouteEntry {
  kind: ApplicationMetadataRouteKind;
  fileName: "sitemap" | "robots" | "manifest" | "llms" | "llms-full";
  outputName: "sitemap.xml" | "robots.txt" | "manifest.webmanifest" | "llms.txt" | "llms-full.txt";
}

interface RedirectEntry {
  route: ParsedRoute;
  pattern: string;
  definition: ProgrammaticRedirectRoute;
}

function getRouteSpecificity(entry: RouteEntry): RouteSegmentSpecificity[] {
  return entry.route.segments.map((segment) => {
    if (!segment.isDynamic) return "static";
    if (!segment.isCatchAll) return "dynamic";
    return segment.isOptional ? "optional-catch-all" : "catch-all";
  });
}

function compareRouteEntries(left: RouteEntry, right: RouteEntry): number {
  return compareRouteSpecificity(getRouteSpecificity(left), getRouteSpecificity(right));
}

/**
 * Manages route discovery and matching for the Farm.js application
 */
export class RouteManager {
  private config: Required<FarmConfig>;
  private routes: Map<string, RouteEntry> = new Map();
  private pageRouteShapes: Map<string, RouteEntry> = new Map();
  private layouts: Map<string, RouteEntry> = new Map();
  private orderedLayouts: OrderedLayoutEntry[] = [];
  private routeSlots: Map<string, RouteSlotEntry> = new Map();
  private routeSlotOwnerSegments: Map<string, ParsedRoute["segments"]> = new Map();
  private loadings: Map<string, RouteEntry> = new Map();
  private errors: Map<string, RouteEntry> = new Map();
  private metadataImages: Map<string, MetadataImageEntry> = new Map();
  private metadataRoutes: Map<string, ApplicationMetadataRouteEntry> = new Map();
  private redirects: Map<string, RedirectEntry> = new Map();
  private programmaticPages: Map<string, ProgrammaticPageRoute> = new Map();
  private programmaticLayouts: Map<string, ProgrammaticLayoutRoute> = new Map();
  private rendererRuntime?: FarmServerRendererRuntime;
  private viteServer?: ViteDevServer;
  /**
   * Plans layouts as server layouts when `experimental.serverLayouts` is set. Only the production
   * build turns this on; the development server renders every layout as before.
   *
   * @internal
   */
  serverLayoutsEnabled = false;

  private clientManifestCache?: {
    projectRoot: string;
    manifest: FarmClientRouteManifest;
    isolatedClientBoundaryModules: ReadonlySet<string>;
  };

  constructor(config: Required<FarmConfig>, viteServer?: ViteDevServer) {
    this.config = config;
    this.viteServer = viteServer;
  }

  setRendererRuntime(rendererRuntime: FarmServerRendererRuntime): void {
    this.rendererRuntime = rendererRuntime;
  }

  /**
   * Discover all routes in the app directory
   */
  async discoverRoutes(): Promise<void> {
    this.invalidateClientManifest();
    this.routes.clear();
    this.pageRouteShapes.clear();
    this.layouts.clear();
    this.orderedLayouts = [];
    this.routeSlots.clear();
    this.routeSlotOwnerSegments.clear();
    this.loadings.clear();
    this.errors.clear();
    this.metadataImages.clear();
    this.metadataRoutes.clear();
    this.redirects.clear();
    this.programmaticPages.clear();
    this.programmaticLayouts.clear();

    for (const source of getFarmSourceRoots(this.config)) {
      await this.discoverFileRoutes(source);
      await this.discoverProgrammaticRoutes(source);
    }

    for (const slot of this.routeSlots.values()) {
      if (slot.interception && !this.pageRouteShapes.has(getRoutePatternShape(slot.pattern))) {
        throw new AmbiguousRouteError(
          `Intercepting route slot "${slot.name}" targets "${slot.pattern}", but no canonical page exists for that URL`,
        );
      }
    }

    this.routes = new Map(
      Array.from(this.routes.entries()).sort(([, left], [, right]) =>
        compareRouteEntries(left, right),
      ),
    );
    this.metadataRoutes = new Map(
      Array.from(this.metadataRoutes.entries()).sort(([, left], [, right]) =>
        compareRouteEntries(left, right),
      ),
    );
    // Directory depth, groups included, so `(auth)/layout` nests inside the root
    // layout it shares a URL with. Without groups this is the URL depth.
    this.orderedLayouts = Array.from(this.layouts.values())
      .sort(
        (left, right) =>
          getRouteDirectoryDepth(left.pattern) - getRouteDirectoryDepth(right.pattern),
      )
      .map((entry) => ({ entry, groupScope: getRouteGroupScope(entry.pattern) }));
    for (const slot of this.routeSlots.values()) {
      if (!this.routeSlotOwnerSegments.has(slot.ownerPattern)) {
        this.routeSlotOwnerSegments.set(
          slot.ownerPattern,
          parseRoutePath(`${slot.ownerPattern}/page.tsx`).segments,
        );
      }
    }

    // Silent discovery - only log if verbose mode enabled
    if (process.env.FARM_VERBOSE) {
      logger.info(
        `Discovered ${this.routes.size} pages, ${this.layouts.size} layouts, and ${this.metadataRoutes.size} metadata routes`,
      );
    }

    if (process.env.FARM_VERBOSE) {
      this.logRoutes();
    }
  }

  /**
   * Find matching route for a given URL path
   */
  matchRoute(
    pathname: string,
    options: {
      interceptFrom?: string;
    } = {},
  ): {
    route: RouteEntry | null;
    params: Record<string, string>;
    layouts: RouteEntry[];
    slots: MatchedRouteSlot[];
  } {
    // Remove trailing slash except for root
    const routePathname = this.toRoutePathname(pathname);
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");
    const pathParts = splitRoutePath(normalizedPath);
    // Find matching page route
    let matchedRoute: RouteEntry | null = null;
    let params: Record<string, string> = {};

    for (const routeEntry of this.routes.values()) {
      const match = matchRouteParts(pathParts, routeEntry.route.segments);
      if (match.matches) {
        matchedRoute = routeEntry;
        params = match.params;
        break;
      }
    }

    // Find all matching layouts (from root to specific)
    const layouts = this.findMatchingLayouts(pathParts, matchedRoute);
    const slots = this.findMatchingRouteSlots(normalizedPath, pathParts, options.interceptFrom);

    return {
      route: matchedRoute,
      params,
      layouts,
      slots,
    };
  }

  /**
   * Get all registered routes
   */
  getRoutes(): Map<string, RouteEntry> {
    return new Map(this.routes);
  }

  /**
   * Get all registered layouts
   */
  getLayouts(): Map<string, RouteEntry> {
    return new Map(this.layouts);
  }

  getRouteSlots(): Map<string, RouteSlotEntry> {
    return new Map(this.routeSlots);
  }

  /** Resolve route rules, inherited layouts, and the page export in precedence order. */
  async resolveRouteRuntimeConfig(pattern: string): Promise<ResolvedFarmRouteRuntimeConfig> {
    const routeEntry = this.routes.get(pattern);
    if (!routeEntry) {
      throw new Error(`Cannot resolve runtime configuration for unknown route "${pattern}"`);
    }

    const inherited = resolveFarmRouteRuleRuntimeConfig(pattern, this.config.routeRules);
    const layouts = this.findMatchingLayouts(splitRoutePath(pattern), routeEntry);
    const layoutConfigs = [];

    for (const layout of layouts) {
      const layoutModule = await this.loadLayoutModule(layout.modulePath);
      layoutConfigs.push(
        normalizeFarmRouteRuntimeConfig(
          getFarmRouteRuntimeConfig(layoutModule),
          `Layout "${layout.pattern}"`,
        ),
      );
    }

    const routeModule = await this.loadRouteModule(routeEntry.modulePath);
    const routeConfig = normalizeFarmRouteRuntimeConfig(
      getFarmRouteRuntimeConfig(routeModule),
      `Route "${pattern}"`,
    );

    return resolveFarmRouteRuntimeConfig(
      mergeFarmRouteRuntimeConfigs(inherited, ...layoutConfigs, routeConfig),
      `Route "${pattern}"`,
    );
  }

  /**
   * Get all route-level loading boundaries.
   */
  getLoadings(): Map<string, RouteEntry> {
    return new Map(this.loadings);
  }

  /**
   * Get all route-level error boundaries.
   */
  getErrors(): Map<string, RouteEntry> {
    return new Map(this.errors);
  }

  getMetadataImages(): Map<string, MetadataImageEntry> {
    return new Map(this.metadataImages);
  }

  getMetadataRoutes(): Map<string, ApplicationMetadataRouteEntry> {
    return new Map(this.metadataRoutes);
  }

  getRedirects(): ProgrammaticRedirectRoute[] {
    return Array.from(this.redirects.values()).map((entry) => entry.definition);
  }

  matchRedirect(
    pathname: string,
    search = "",
  ): {
    redirect: ProgrammaticRedirectRoute;
    destination: string;
    statusCode: number;
    params: Record<string, string>;
  } | null {
    const i18n = this.getI18nConfig();
    const localeMatch = i18n ? resolveFarmLocalePath(pathname, i18n) : undefined;
    const routePathname = localeMatch?.pathname || pathname;
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");

    for (const redirectEntry of this.redirects.values()) {
      const match = matchRoute(normalizedPath, redirectEntry.route.segments);
      if (!match.matches) continue;

      const statusCode =
        redirectEntry.definition.statusCode || (redirectEntry.definition.permanent ? 308 : 307);

      return {
        redirect: redirectEntry.definition,
        destination: appendFarmRedirectQuery(
          this.localizeRedirectDestination(
            interpolateRedirectDestination(redirectEntry.definition.destination, match.params),
            localeMatch?.locale,
          ),
          search,
        ),
        statusCode,
        params: match.params,
      };
    }

    return null;
  }

  /**
   * Return the nearest matching loading boundary for a pathname. Pass the page
   * `matchRoute` selected when it is known (`null` for none); otherwise the page is
   * matched only if a boundary inside a route group needs it.
   */
  getMatchingLoading(pathname: string, route?: RouteEntry | null): RouteEntry | null {
    return this.findNearestBoundary(this.toRoutePathname(pathname), this.loadings, route);
  }

  /**
   * Return the nearest matching error boundary for a pathname. `route` works as it
   * does for `getMatchingLoading`.
   */
  getMatchingError(pathname: string, route?: RouteEntry | null): RouteEntry | null {
    return this.findNearestBoundary(this.toRoutePathname(pathname), this.errors, route);
  }

  matchMetadataImage(pathname: string): {
    image: MetadataImageEntry;
    params: Record<string, string>;
    pagePath: string;
  } | null {
    const routePathname = this.toRoutePathname(pathname);
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");
    const suffix = getMetadataImageSuffix(normalizedPath);
    if (!suffix) return null;

    const pagePath = normalizedPath.slice(0, -suffix.fileName.length - 1) || "/";

    for (const imageEntry of this.metadataImages.values()) {
      if (imageEntry.kind !== suffix.kind) continue;

      const match = matchRoute(pagePath, imageEntry.route.segments);
      if (!match.matches) continue;

      return {
        image: imageEntry,
        params: match.params,
        pagePath,
      };
    }

    return null;
  }

  matchMetadataRoute(pathname: string): {
    metadata: ApplicationMetadataRouteEntry;
    params: Record<string, string>;
    routePath: string;
  } | null {
    const routePathname = this.toRoutePathname(pathname);
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");
    const suffix = getApplicationMetadataRouteSuffix(normalizedPath);
    if (!suffix) return null;

    const routePath = normalizedPath.slice(0, -suffix.outputName.length - 1) || "/";
    for (const metadata of this.metadataRoutes.values()) {
      if (metadata.kind !== suffix.kind) continue;
      const match = matchRoute(routePath, metadata.route.segments);
      if (!match.matches) continue;
      return { metadata, params: match.params, routePath };
    }

    return null;
  }

  getMatchingMetadataRoute(
    pathname: string,
    kind: ApplicationMetadataRouteKind,
  ): {
    metadata: ApplicationMetadataRouteEntry;
    params: Record<string, string>;
    routePath: string;
  } | null {
    const routePathname = this.toRoutePathname(pathname);
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    let bestMatch: {
      metadata: ApplicationMetadataRouteEntry;
      params: Record<string, string>;
      routePath: string;
    } | null = null;

    for (const metadata of this.metadataRoutes.values()) {
      if (metadata.kind !== kind || metadata.route.segments.length > pathSegments.length) continue;
      const routePath =
        metadata.route.segments.length === 0
          ? "/"
          : `/${pathSegments.slice(0, metadata.route.segments.length).join("/")}`;
      const match = matchRoute(routePath, metadata.route.segments);
      if (!match.matches) continue;
      if (!bestMatch || metadata.route.segments.length > bestMatch.metadata.route.segments.length) {
        bestMatch = { metadata, params: match.params, routePath };
      }
    }

    return bestMatch;
  }

  resolveMetadataRoutePath(
    metadata: ApplicationMetadataRouteEntry,
    params: Record<string, string> = {},
  ): string {
    const routePath = routeSegmentsToPath(metadata.route.segments, params);
    return routePath === "/" ? `/${metadata.outputName}` : `${routePath}/${metadata.outputName}`;
  }

  getMatchingMetadataImage(
    pathname: string,
    kind: MetadataImageKind,
  ): {
    image: MetadataImageEntry;
    params: Record<string, string>;
  } | null {
    const routePathname = this.toRoutePathname(pathname);
    const normalizedPath = routePathname === "/" ? "/" : routePathname.replace(/\/$/, "");
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    let bestMatch: {
      image: MetadataImageEntry;
      params: Record<string, string>;
    } | null = null;

    for (const imageEntry of this.metadataImages.values()) {
      if (imageEntry.kind !== kind) continue;
      if (imageEntry.route.segments.length > pathSegments.length) continue;

      const candidatePath =
        imageEntry.route.segments.length === 0
          ? "/"
          : `/${pathSegments.slice(0, imageEntry.route.segments.length).join("/")}`;
      const match = matchRoute(candidatePath, imageEntry.route.segments);
      if (!match.matches) continue;

      if (!bestMatch || imageEntry.route.segments.length > bestMatch.image.route.segments.length) {
        bestMatch = {
          image: imageEntry,
          params: match.params,
        };
      }
    }

    return bestMatch;
  }

  resolveMetadataImagePath(image: MetadataImageEntry, params: Record<string, string> = {}): string {
    const pagePath = routeSegmentsToPath(image.route.segments, params);
    const imagePath = pagePath === "/" ? `/${image.fileName}` : `${pagePath}/${image.fileName}`;
    return image.staticInfo ? `${imagePath}?v=${image.staticInfo.hash}` : imagePath;
  }

  /**
   * Generate the compiled route decisions consumed by SPA navigation.
   * Requests still fetch route data, but never inspect component source.
   */
  generateClientManifest(projectRoot: string = this.config.root): FarmClientRouteManifest {
    const normalizedProjectRoot = path.resolve(projectRoot);
    if (this.clientManifestCache?.projectRoot === normalizedProjectRoot) {
      return this.clientManifestCache.manifest;
    }

    const toUrlPath = (absolutePath: string) => {
      const rootRelative = toRootRelativeUrlPath(absolutePath, normalizedProjectRoot);
      if (rootRelative !== undefined) return rootRelative;
      if (path.isAbsolute(absolutePath)) {
        const normalized = absolutePath.replace(/\\/g, "/");
        return normalized.startsWith("/") ? `/@fs${normalized}` : `/@fs/${normalized}`;
      }
      return absolutePath;
    };

    const integrationProviders = getIntegrationProviders(this.config.integrations).filter(
      (provider) => provider.component || provider.type === "clerk",
    );
    const unsupportedIntegrationProvider = integrationProviders.find(
      (provider) => provider.supportsIsolatedHydration !== true,
    );
    if (
      this.config.experimental?.isolatedClientHydration === "enabled" &&
      this.config.experimental?.serverComponents !== true &&
      unsupportedIntegrationProvider
    ) {
      logger.warn(
        `[Farm.js] isolated hydration kept route-wide because integration provider "${unsupportedIntegrationProvider.name}" does not declare supportsIsolatedHydration: true.`,
      );
    }
    const isolatedMode = resolveFarmIsolatedClientHydrationMode(
      this.config.experimental?.isolatedClientHydration,
      {
        serverComponents: this.config.experimental?.serverComponents === true,
        hasUnsupportedIntegrationProvider: Boolean(unsupportedIntegrationProvider),
      },
    );
    const planOptions = getFarmClientHydrationPlanOptions(
      this.config.renderer,
      Boolean(unsupportedIntegrationProvider),
    );
    const layoutEntries = Array.from(this.layouts.values()).map((entry) => ({
      entry,
      metadata: getClientModuleHydrationPlan(
        entry.modulePath,
        normalizedProjectRoot,
        isolatedMode,
        planOptions,
      ),
    }));

    // A Markdown page's client components come from the configured MDX components module.
    const markdownPagePlan = createMarkdownPageHydrationPlanner(
      resolveFarmMdxComponentsModulePath(resolveMdxConfig(this.config.mdx), normalizedProjectRoot),
      normalizedProjectRoot,
      isolatedMode,
      planOptions,
    );
    const routeEntries = Array.from(this.routes.values()).map((entry) => ({
      entry,
      metadata: isFarmMarkdownPageFile(entry.modulePath)
        ? markdownPagePlan()
        : getClientModuleHydrationPlan(
            entry.modulePath,
            normalizedProjectRoot,
            isolatedMode,
            planOptions,
          ),
    }));
    // Every Markdown page shares the components module, so one warning covers them all.
    const markdownFallback = routeEntries.find(
      ({ entry, metadata }) => isFarmMarkdownPageFile(entry.modulePath) && metadata.fallbackReason,
    );
    if (markdownFallback) {
      logger.warn(
        `[Farm.js] client components in Markdown pages stay static: ${markdownFallback.metadata.fallbackReason}.`,
      );
    }
    const markdownStaticPackages = routeEntries.find(
      ({ entry, metadata }) =>
        isFarmMarkdownPageFile(entry.modulePath) && metadata.staticPackageBoundaries,
    )?.metadata.staticPackageBoundaries;
    if (markdownStaticPackages) {
      logger.info(
        `[Farm.js] Markdown pages render client components from ${markdownStaticPackages.join(", ")} as static HTML: package client components cannot be isolated yet.`,
      );
    }
    for (const { entry, metadata } of [...layoutEntries, ...routeEntries]) {
      if (isFarmMarkdownPageFile(entry.modulePath) || !metadata.staticPackageBoundaries) continue;
      logger.info(
        `[Farm.js] ${entry.pattern} is async, so it renders client components from ${metadata.staticPackageBoundaries.join(", ")} as static HTML: package client components cannot be isolated yet.`,
      );
    }

    applyFarmServerLayouts({
      enabled: this.serverLayoutsEnabled && this.config.experimental?.serverLayouts === true,
      layouts: layoutEntries.map(({ entry, metadata }) => ({
        pattern: entry.pattern,
        modulePath: entry.modulePath,
        plan: metadata,
      })),
      pages: routeEntries.map(({ entry, metadata }) => ({
        directory: getRouteEntryDirectory(entry),
        shouldHydrate: metadata.shouldHydrate,
      })),
      slotOwners: Array.from(
        this.routeSlots.values(),
        (slot) => slot.ownerDirectory ?? slot.ownerPattern,
      ),
      root: normalizedProjectRoot,
      mode: isolatedMode,
      planOptions,
      layoutAppliesToRoute: routeBoundaryCoversDirectory,
    });

    // Pages are compared by directory so a layout inside a route group applies
    // only to the pages in that group.
    enforceFarmIsolatedHydrationRouteBudget(
      layoutEntries.map(({ entry, metadata }) => ({
        pattern: entry.pattern,
        depth: getRouteDirectoryDepth(entry.pattern),
        metadata,
      })),
      routeEntries.map(({ entry, metadata }) => ({
        pattern: getRouteEntryDirectory(entry),
        depth: getRouteDirectoryDepth(getRouteEntryDirectory(entry)),
        metadata,
      })),
      routeBoundaryCoversDirectory,
    );

    for (const { entry, metadata } of [...layoutEntries, ...routeEntries]) {
      if (!metadata.costGuardExceeded) continue;
      logger.warn(
        `[Farm.js] isolated hydration kept route-wide for ${entry.modulePath}: ${metadata.fallbackReason}.`,
      );
    }
    if (isolatedMode === "analyze") {
      for (const { entry, metadata } of [...layoutEntries, ...routeEntries]) {
        if (!metadata.isolatedHydrationEligible) continue;
        logger.info(
          `[Farm.js] isolated hydration analysis: ${entry.modulePath} can keep ${metadata.isolatedBoundaries.length} client ${metadata.isolatedBoundaries.length === 1 ? "boundary" : "boundaries"} while excluding its server owner from the browser graph.`,
        );
      }
    }

    const routes = routeEntries.map(({ entry, metadata }) => {
      const programmaticPage = this.programmaticPages.get(entry.modulePath);
      const layoutShouldHydrate = layoutEntries.some(
        ({ entry: layout, metadata: layoutMetadata }) =>
          layoutMetadata.shouldHydrate &&
          routeBoundaryCoversDirectory(layout.pattern, getRouteEntryDirectory(entry)),
      );
      return {
        pattern: entry.pattern,
        ...(entry.directory ? { directory: entry.directory } : {}),
        modulePath: toUrlPath(entry.modulePath),
        shouldHydrate: metadata.shouldHydrate,
        isClientComponent: metadata.isClientComponent,
        islandStrategy: metadata.islandStrategy,
        ...(metadata.hasIsolatedClientBoundaries
          ? {
              hasIsolatedClientBoundaries: true as const,
              isolatedBoundaries: metadata.isolatedBoundaries.map((boundary) => ({
                ...boundary,
                modulePath: toUrlPath(boundary.modulePath),
              })),
            }
          : {}),
        ...(usesFarmServerTree(metadata) ? { serverTree: true as const } : {}),
        renderPlan: createFarmRouteRenderPlan({
          pageShouldHydrate: metadata.shouldHydrate,
          layoutShouldHydrate,
          islandStrategy: metadata.islandStrategy,
        }),
        suppressedAsyncHydration: metadata.suppressedAsyncHydration,
        ...(metadata.suppressedAsyncHydration && metadata.fallbackReason
          ? { suppressedAsyncHydrationReason: metadata.fallbackReason }
          : {}),
        search: getProgrammaticRouteSearchClientOptions(programmaticPage?.search),
        segments: entry.route.segments.map((seg) => ({
          segment: seg.segment,
          isDynamic: seg.isDynamic,
          isCatchAll: seg.isCatchAll,
          isOptional: seg.isOptional,
        })),
      };
    });

    const layouts = layoutEntries.map(({ entry, metadata }) => ({
      pattern: entry.pattern,
      modulePath: toUrlPath(entry.modulePath),
      shouldHydrate: metadata.shouldHydrate,
      isClientComponent: metadata.isClientComponent,
      islandStrategy: metadata.islandStrategy,
      ...(metadata.hasIsolatedClientBoundaries
        ? {
            hasIsolatedClientBoundaries: true as const,
            isolatedBoundaries: metadata.isolatedBoundaries.map((boundary) => ({
              ...boundary,
              modulePath: toUrlPath(boundary.modulePath),
            })),
          }
        : {}),
      suppressedAsyncHydration: metadata.suppressedAsyncHydration,
      ...(metadata.suppressedAsyncHydration && metadata.fallbackReason
        ? { suppressedAsyncHydrationReason: metadata.fallbackReason }
        : {}),
    }));

    const slots = Array.from(this.routeSlots.values()).map((entry) => {
      const metadata = getClientModuleMetadata(entry.modulePath, normalizedProjectRoot);
      return {
        name: entry.name,
        ownerPattern: entry.ownerPattern,
        pattern: entry.pattern,
        modulePath: toUrlPath(entry.modulePath),
        containerId: entry.containerId,
        interception: entry.interception,
        fallback: entry.fallback,
        shouldHydrate: metadata.shouldHydrate,
        isClientComponent: metadata.isClientComponent,
        segments: entry.route.segments,
      };
    });

    const isolatedClientBoundaryModules = new Set<string>();
    for (const { metadata } of [...layoutEntries, ...routeEntries]) {
      if (!metadata.hasIsolatedClientBoundaries) continue;
      for (const boundary of metadata.isolatedBoundaries) {
        isolatedClientBoundaryModules.add(path.resolve(boundary.modulePath));
      }
    }

    const manifest = { routes, layouts, slots };
    this.clientManifestCache = {
      projectRoot: normalizedProjectRoot,
      manifest,
      isolatedClientBoundaryModules,
    };
    return manifest;
  }

  /**
   * Rebuild route metadata transactionally for HMR. If a file is temporarily
   * invalid while it is being edited, keep the last usable plan so unrelated
   * updates and the next repair can still compare against it.
   *
   * @internal
   */
  regenerateClientManifest(projectRoot: string = this.config.root): FarmClientRouteManifest {
    const previousCache = this.clientManifestCache;
    this.clientManifestCache = undefined;
    try {
      return this.generateClientManifest(projectRoot);
    } catch (error) {
      this.clientManifestCache = previousCache;
      throw error;
    }
  }

  /** @internal Client modules selected by the compiled hydration ownership plan. */
  getIsolatedClientBoundaryModules(projectRoot: string = this.config.root): ReadonlySet<string> {
    const normalizedProjectRoot = path.resolve(projectRoot);
    this.generateClientManifest(normalizedProjectRoot);
    return this.clientManifestCache?.isolatedClientBoundaryModules ?? new Set();
  }

  /**
   * Invalidate build-time route metadata after a page or layout changes in dev.
   * Navigation requests reuse the cached manifest and never inspect source files.
   */
  invalidateClientManifest(): void {
    this.clientManifestCache = undefined;
  }

  /**
   * Load a route module dynamically
   */
  async loadRouteModule(modulePath: string): Promise<RouteModule> {
    try {
      const programmaticPage = this.programmaticPages.get(modulePath);
      if (programmaticPage) {
        const { createRouteModuleFromProgrammaticPage } = await import("../routes");
        return createRouteModuleFromProgrammaticPage(programmaticPage, this.rendererRuntime);
      }

      if (isFarmMarkdownPageFile(modulePath)) {
        const mdxConfig = resolveMdxConfig(this.config.mdx);
        const components = await loadFarmMdxComponents(mdxConfig, {
          root: this.config.root,
          loadModule: this.viteServer
            ? (componentModulePath) => loadFarmDevModule(this.viteServer!, componentModulePath)
            : undefined,
        });
        return await createFarmMarkdownRouteModuleFromFile(modulePath, {
          components,
          config: mdxConfig,
        });
      }

      if (this.viteServer) {
        const module = await loadFarmDevModule(this.viteServer, modulePath);
        return module as RouteModule;
      } else {
        const module = await import(/* @vite-ignore */ modulePath);
        return module as RouteModule;
      }
    } catch (error) {
      logger.error(`Failed to load route module: ${modulePath}`);
      throw error;
    }
  }

  /**
   * Load a layout module dynamically
   */
  async loadLayoutModule(modulePath: string): Promise<LayoutModule> {
    try {
      const programmaticLayout = this.programmaticLayouts.get(modulePath);
      if (programmaticLayout) {
        const { createLayoutModuleFromProgrammaticLayout } = await import("../routes");
        return createLayoutModuleFromProgrammaticLayout(programmaticLayout) as LayoutModule;
      }

      if (this.viteServer) {
        const module = await loadFarmDevModule(this.viteServer, modulePath);
        return module as LayoutModule;
      } else {
        const module = await import(/* @vite-ignore */ modulePath);
        return module as LayoutModule;
      }
    } catch (error) {
      logger.error(`Failed to load layout module: ${modulePath}`);
      throw error;
    }
  }

  /**
   * Create a route pattern from parsed route
   */
  private createRoutePattern(route: ParsedRoute): string {
    if (route.segments.length === 0) return "/";

    return "/" + route.segments.map(formatRouteSegment).join("/");
  }

  private registerPageRoute(entry: RouteEntry): void {
    assertUniqueRouteParameters(entry.pattern);
    const shape = getRoutePatternShape(entry.pattern);
    const existing = this.pageRouteShapes.get(shape);

    if (existing && existing.pattern !== entry.pattern) {
      if (existing.sourceRoot === entry.sourceRoot) {
        throw new Error(
          `Ambiguous page routes "${existing.pattern}" and "${entry.pattern}" match the same URLs. Found ${existing.modulePath} and ${entry.modulePath}. Keep only one route for this URL shape.`,
        );
      }
      this.routes.delete(existing.pattern);
    }

    this.routes.set(entry.pattern, entry);
    this.pageRouteShapes.set(shape, entry);
  }

  private async discoverFileRoutes(source: FarmSourceRoot): Promise<void> {
    const appDir = resolveAppPath(source.root, source.srcDir, "app");
    const componentExtensions = getFarmRendererComponentExtensions(this.config.renderer).map(
      (extension) => extension.slice(1),
    );
    const componentGlob = componentExtensions.join(",");
    const pageFiles = await safeGlobFiles(`**/page.{${componentGlob},md,mdx}`, appDir);
    const slotDefaultFiles = await safeGlobFiles(`**/@*/**/default.{${componentGlob}}`, appDir);
    const layoutFiles = await safeGlobFiles(`**/layout.{${componentGlob}}`, appDir);
    const loadingFiles = await safeGlobFiles(`**/loading.{${componentGlob}}`, appDir);
    const errorFiles = await safeGlobFiles(`**/error.{${componentGlob}}`, appDir);
    const metadataImageFiles = await safeGlobFiles(
      `**/{opengraph-image,twitter-image}.{${componentGlob},png,jpg,jpeg,gif,webp}`,
      appDir,
    );
    const metadataRouteFiles = await safeGlobFiles(
      "**/{sitemap,robots,manifest,llms,llms-full}.{ts,js}",
      appDir,
    );

    const canonicalPageGroups = new Map<
      string,
      {
        route: ParsedRoute;
        files: string[];
      }
    >();
    for (const file of pageFiles.filter((candidate) => parseRouteSlotFile(candidate) === null)) {
      const route = parseRoutePath(file);
      const pattern = this.createRoutePattern(route);
      const group = canonicalPageGroups.get(pattern);
      if (group) {
        group.files.push(file);
      } else {
        canonicalPageGroups.set(pattern, {
          route,
          files: [file],
        });
      }
    }

    for (const [pattern, group] of canonicalPageGroups) {
      const componentFiles = group.files.filter((file) => !isFarmMarkdownPageFile(file));
      const markdownFiles = group.files.filter(isFarmMarkdownPageFile);
      if (componentFiles.length > 1) {
        throw new Error(
          `Duplicate page route "${pattern}". Found ${componentFiles
            .map((file) => path.join(appDir, file))
            .join(" and ")}.`,
        );
      }
      if (markdownFiles.length > 1) {
        throw new Error(
          `Duplicate markdown representation for page route "${pattern}". Found ${markdownFiles
            .map((file) => path.join(appDir, file))
            .join(" and ")}.`,
        );
      }

      const componentFile = componentFiles[0];
      const markdownFile = markdownFiles[0];
      const primaryFile = componentFile || markdownFile;
      if (!primaryFile) continue;

      const modulePath = path.join(appDir, primaryFile);
      const existing = this.routes.get(pattern);
      if (existing?.sourceRoot === source.root) {
        throw new Error(
          `Duplicate page route "${pattern}". Found both ${existing.modulePath} and ${modulePath}.`,
        );
      }
      this.registerPageRoute({
        route: group.route,
        modulePath,
        ...(markdownFile
          ? {
              markdownSourcePath: path.join(appDir, markdownFile),
            }
          : {}),
        pattern,
        ...getPageDirectoryField(group.route, pattern),
        source: "file",
        sourceRoot: source.root,
      });
    }

    for (const [kind, files, target] of [
      ["layout", layoutFiles, this.layouts],
      ["loading", loadingFiles, this.loadings],
      ["error", errorFiles, this.errors],
    ] as const) {
      for (const file of files) {
        const route = parseRoutePath(file);
        const modulePath = path.join(appDir, file);
        // Keyed by directory: `(auth)/layout.tsx` and `layout.tsx` share the URL "/".
        const pattern = createRouteDirectoryPattern(route);
        const existing = target.get(pattern);
        if (existing?.sourceRoot === source.root) {
          throw new Error(
            `Duplicate ${kind} route "${pattern}". Found both ${existing.modulePath} and ${modulePath}.`,
          );
        }
        target.set(pattern, {
          route,
          modulePath,
          pattern,
          source: "file",
          sourceRoot: source.root,
        });
      }
    }

    for (const file of [...pageFiles, ...slotDefaultFiles]) {
      const slot = parseRouteSlotFile(file);
      if (!slot) continue;

      const modulePath = path.join(appDir, file);
      const pattern = this.createRoutePattern(slot.route);
      const ownerPattern = this.createRoutePattern(slot.ownerRoute);
      const ownerDirectory = createRouteDirectoryPattern(slot.ownerRoute);
      const key = `${ownerPattern}:${slot.name}:${slot.interception ? "intercept" : "slot"}:${
        slot.fallback ? "default" : pattern
      }`;
      const existing = this.routeSlots.get(key);
      if (existing?.sourceRoot === source.root) {
        throw new Error(
          `Duplicate route slot "${slot.name}" for "${pattern}". Found both ${existing.modulePath} and ${modulePath}.`,
        );
      }

      this.routeSlots.set(key, {
        route: slot.route,
        modulePath,
        pattern,
        source: "file",
        sourceRoot: source.root,
        name: slot.name,
        ownerPattern,
        ...(ownerDirectory === ownerPattern ? {} : { ownerDirectory }),
        interception: slot.interception,
        fallback: slot.fallback,
        containerId: createRouteSlotContainerId(slot.name, ownerPattern),
      });
    }

    for (const file of metadataImageFiles) {
      const fileBase = path.basename(file, path.extname(file));
      const kind: MetadataImageKind = fileBase === "twitter-image" ? "twitter" : "opengraph";
      const fileName = kind === "twitter" ? "twitter-image" : "opengraph-image";
      const route = parseRoutePath(file);
      const modulePath = path.join(appDir, file);
      const pattern = this.createRoutePattern(route);
      const key = `${kind}:${pattern}`;
      const existing = this.metadataImages.get(key);
      const sourceType = isStaticMetadataImageFile(file) ? "static" : "module";

      if (existing?.sourceRoot === source.root) {
        throw new Error(
          `Duplicate ${fileName} route "${pattern}". Found both ${existing.modulePath} and ${modulePath}. Keep only one static image or module per route segment.`,
        );
      }

      const staticInfo =
        sourceType === "static" ? await inspectStaticMetadataImage(modulePath) : undefined;

      this.metadataImages.set(key, {
        route,
        modulePath,
        pattern,
        kind,
        fileName,
        sourceType,
        staticInfo,
        source: "file",
        sourceRoot: source.root,
      });
    }

    for (const file of metadataRouteFiles) {
      const descriptor = getApplicationMetadataRouteDescriptor(
        path.basename(file, path.extname(file)),
      );
      if (!descriptor) continue;
      const route = parseRoutePath(file);
      const modulePath = path.join(appDir, file);
      const pattern = this.createRoutePattern(route);
      const key = `${descriptor.kind}:${pattern}`;
      const existing = this.metadataRoutes.get(key);

      if (existing?.sourceRoot === source.root) {
        throw new Error(
          `Duplicate ${descriptor.fileName} route "${pattern}". Found both ${existing.modulePath} and ${modulePath}. Keep only one .ts or .js metadata route per segment.`,
        );
      }

      this.metadataRoutes.set(key, {
        route,
        modulePath,
        pattern,
        ...descriptor,
        source: "file",
        sourceRoot: source.root,
      });
    }
  }

  private async discoverProgrammaticRoutes(source: FarmSourceRoot): Promise<void> {
    const manifests = await loadProgrammaticRouteManifests({
      root: source.root,
      srcDir: source.srcDir,
      loadModule: (filePath) => this.loadProgrammaticRoutesModule(filePath),
    });

    for (const { filePath, manifest } of manifests) {
      for (const definition of manifest.routes) {
        if (definition.kind === "page") {
          const route = parseProgrammaticRoutePath(definition.path, "page");
          const pattern = this.createRoutePattern(route);
          const existing = this.routes.get(pattern);

          if (existing?.sourceRoot === source.root) {
            throw new Error(
              `Duplicate page route "${pattern}". Found both ${existing.modulePath} and programmatic route in ${filePath}.`,
            );
          }

          const modulePath = createProgrammaticRouteModuleId(filePath, "page", definition.path);
          this.programmaticPages.set(modulePath, definition);
          this.registerPageRoute({
            route,
            modulePath,
            pattern,
            ...getPageDirectoryField(route, pattern),
            source: "programmatic",
            sourceRoot: source.root,
          });
        }

        if (definition.kind === "layout") {
          const route = parseProgrammaticRoutePath(definition.path, "layout");
          const pattern = createRouteDirectoryPattern(route);
          const existing = this.layouts.get(pattern);
          if (existing?.sourceRoot === source.root) {
            throw new Error(
              `Duplicate layout route "${pattern}". Found both ${existing.modulePath} and programmatic route in ${filePath}.`,
            );
          }
          const modulePath = createProgrammaticRouteModuleId(filePath, "layout", definition.path);
          this.programmaticLayouts.set(modulePath, definition);
          this.layouts.set(pattern, {
            route,
            modulePath,
            pattern,
            source: "programmatic",
            sourceRoot: source.root,
          });
        }

        if (definition.kind === "redirect") {
          const route = parseProgrammaticRoutePath(definition.source, "page");
          const pattern = this.createRoutePattern(route);
          this.redirects.set(pattern, {
            route,
            pattern,
            definition,
          });
        }
      }
    }
  }

  private async loadProgrammaticRoutesModule(filePath: string): Promise<Record<string, any>> {
    if (this.viteServer) {
      const viteRoot = this.viteServer.config?.root || this.config.root || process.cwd();
      return await loadFarmDevModule(this.viteServer, toViteModuleId(filePath, viteRoot));
    }

    return await import(/* @vite-ignore */ toFileModuleUrl(filePath));
  }

  /**
   * Find all layouts that should wrap a given path. A layout inside a route group
   * wraps only the pages in that group, so it needs the selected page.
   */
  private findMatchingLayouts(
    pathnameParts: readonly string[],
    route: RouteEntry | null,
  ): RouteEntry[] {
    const matchingLayouts: RouteEntry[] = [];

    for (const { entry, groupScope } of this.orderedLayouts) {
      if (!matchRoutePrefixParts(pathnameParts, entry.route.segments)) continue;
      if (
        groupScope !== null &&
        !isInRouteGroupScope(route && getRouteEntryDirectory(route), groupScope)
      ) {
        continue;
      }
      matchingLayouts.push(entry);
    }

    return matchingLayouts;
  }

  private matchPageRoute(pathnameParts: readonly string[]): RouteEntry | null {
    for (const routeEntry of this.routes.values()) {
      if (matchRouteParts(pathnameParts, routeEntry.route.segments).matches) return routeEntry;
    }
    return null;
  }

  private findMatchingRouteSlots(
    pathname: string,
    pathnameParts: readonly string[],
    interceptFrom?: string,
  ): MatchedRouteSlot[] {
    const groups = new Map<string, RouteSlotEntry[]>();
    for (const entry of this.routeSlots.values()) {
      if (!this.matchesRoutePrefix(pathname, entry.ownerPattern, pathnameParts)) continue;
      const key = `${entry.ownerPattern}:${entry.name}`;
      const entries = groups.get(key) ?? [];
      entries.push(entry);
      groups.set(key, entries);
    }

    const normalizedFrom = interceptFrom
      ? this.toRoutePathname(new URL(interceptFrom, "http://farm.local").pathname)
      : undefined;
    const normalizedFromParts = normalizedFrom ? splitRoutePath(normalizedFrom) : undefined;
    const matches: MatchedRouteSlot[] = [];

    for (const entries of groups.values()) {
      const candidates = entries
        .filter((entry) => !entry.fallback)
        .filter(
          (entry) =>
            !entry.interception ||
            (normalizedFrom !== undefined &&
              this.matchesRoutePrefix(normalizedFrom, entry.ownerPattern, normalizedFromParts)),
        )
        .map((entry) => ({
          entry,
          match: matchRouteParts(pathnameParts, entry.route.segments),
        }))
        .filter((candidate) => candidate.match.matches)
        .sort((left, right) => {
          if (left.entry.interception !== right.entry.interception) {
            return left.entry.interception ? -1 : 1;
          }
          return compareRouteEntries(left.entry, right.entry);
        });

      const selected = candidates[0];
      if (selected) {
        matches.push({
          name: selected.entry.name,
          ownerPattern: selected.entry.ownerPattern,
          ...(selected.entry.ownerDirectory
            ? { ownerDirectory: selected.entry.ownerDirectory }
            : {}),
          containerId: selected.entry.containerId,
          interception: selected.entry.interception,
          fallback: false,
          route: selected.entry,
          params: selected.match.params,
        });
        continue;
      }

      const fallback = entries.find((entry) => entry.fallback);
      if (fallback) {
        matches.push({
          name: fallback.name,
          ownerPattern: fallback.ownerPattern,
          ...(fallback.ownerDirectory ? { ownerDirectory: fallback.ownerDirectory } : {}),
          containerId: fallback.containerId,
          interception: false,
          fallback: true,
          route: fallback,
          params: {},
        });
      }
    }

    return matches.sort((left, right) => {
      const ownerDifference = left.route.route.segments.length - right.route.route.segments.length;
      return ownerDifference || left.name.localeCompare(right.name);
    });
  }

  private matchesRoutePrefix(
    pathname: string,
    pattern: string,
    pathnameParts: readonly string[] = splitRoutePath(pathname),
  ): boolean {
    if (pattern === "/") return true;
    const patternSegments =
      this.routeSlotOwnerSegments.get(pattern) ?? parseRoutePath(`${pattern}/page.tsx`).segments;
    return matchRoutePrefixParts(pathnameParts, patternSegments);
  }

  private findNearestBoundary(
    pathname: string,
    boundaries: Map<string, RouteEntry>,
    route?: RouteEntry | null,
  ): RouteEntry | null {
    const normalizedPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    let bestMatch: RouteEntry | null = null;
    let page = route;

    for (const boundaryEntry of boundaries.values()) {
      if (!matchRoutePrefix(normalizedPath, boundaryEntry.route.segments)) continue;
      const groupScope = getRouteGroupScope(boundaryEntry.pattern);
      if (groupScope !== null) {
        if (page === undefined) page = this.matchPageRoute(splitRoutePath(normalizedPath));
        if (!isInRouteGroupScope(page && getRouteEntryDirectory(page), groupScope)) continue;
      }

      // The deepest URL wins; a group boundary beats its parent at the same URL.
      const depth = boundaryEntry.route.segments.length;
      const bestDepth = bestMatch?.route.segments.length ?? -1;
      if (
        !bestMatch ||
        depth > bestDepth ||
        (depth === bestDepth &&
          getRouteDirectoryDepth(boundaryEntry.pattern) > getRouteDirectoryDepth(bestMatch.pattern))
      ) {
        bestMatch = boundaryEntry;
      }
    }

    return bestMatch;
  }

  /**
   * Log discovered routes for debugging
   */
  private logRoutes(): void {
    if (this.routes.size > 0) {
      logger.info("Registered routes:");
      for (const [pattern, entry] of this.routes) {
        console.log(`  ${pattern} -> ${entry.modulePath}`);
      }
    }

    if (this.layouts.size > 0) {
      logger.info("Registered layouts:");
      for (const [pattern, entry] of this.layouts) {
        console.log(`  ${pattern} -> ${entry.modulePath}`);
      }
    }
  }

  /**
   * Collect SSG pages for static generation
   *
   * Returns all pages marked with `export const ssg = true` along with
   * their pre-computed paths (for dynamic routes using getStaticPaths)
   */
  async collectSSGPages(): Promise<SSGCollectionResult> {
    const routes = Array.from(this.routes.values()).map((entry) => ({
      path: entry.pattern,
      filePath: entry.modulePath,
      isDynamic: entry.route.segments.some((seg) => seg.isDynamic),
      pattern: entry.pattern,
    }));

    const i18n = this.getI18nConfig();
    const result = await collectSSGPages(routes, (filePath) => this.loadRouteModule(filePath), {
      suggestStaticRendering: shouldSuggestStaticRenderingForI18n(i18n),
    });
    if (!i18n) {
      return result;
    }

    // A single static URL cannot safely vary by cookie or Accept-Language.
    // Keep locale-without-prefix pages dynamic so caches never pin one language.
    if (i18n.routing === "none") {
      return {
        ssg: [],
        ssr: Array.from(new Set([...result.ssr, ...result.ssg.map((page) => page.urlPath)])),
      };
    }

    return {
      ssg: result.ssg.flatMap((page) =>
        i18n.locales.map((locale) => ({
          ...page,
          urlPath: localizeFarmPathname(page.urlPath, locale, i18n),
        })),
      ),
      ssr: result.ssr.flatMap((routePath) =>
        i18n.locales.map((locale) => localizeFarmPathname(routePath, locale, i18n)),
      ),
    };
  }

  private toRoutePathname(pathname: string): string {
    const i18n = this.getI18nConfig();
    // Locale stripping removes the basePath too; production strips it the same way.
    return i18n
      ? stripFarmLocaleFromPathname(pathname, i18n)
      : stripFarmBasePath(pathname, this.config.basePath);
  }

  private localizeRedirectDestination(destination: string, locale?: string): string {
    if (!locale || !destination.startsWith("/") || destination.startsWith("//")) {
      return destination;
    }
    const i18n = this.getI18nConfig();
    return i18n ? localizeFarmHref(destination, locale, i18n) : destination;
  }

  private getI18nConfig(): ResolvedFarmI18nConfig | undefined {
    const i18n = this.config.i18n;
    return i18n && typeof i18n === "object" && "enabled" in i18n && i18n.enabled ? i18n : undefined;
  }

  /**
   * Check if a route is SSG
   */
  async isRouteSSG(modulePath: string): Promise<boolean> {
    try {
      const mod = await this.loadRouteModule(modulePath);
      const rendering = await resolveRouteRenderingConfigFromFile(mod, modulePath);
      return rendering.ssg;
    } catch {
      return false;
    }
  }

  /**
   * Check if a route has ISR (Incremental Static Regeneration)
   */
  async hasRouteISR(modulePath: string): Promise<boolean> {
    try {
      const mod = await this.loadRouteModule(modulePath);
      const rendering = await resolveRouteRenderingConfigFromFile(mod, modulePath);
      return rendering.ssg && typeof rendering.revalidate === "number" && rendering.revalidate > 0;
    } catch {
      return false;
    }
  }

  /**
   * Get revalidation interval for a route
   */
  async getRouteRevalidateInterval(modulePath: string): Promise<number | undefined> {
    try {
      const mod = await this.loadRouteModule(modulePath);
      const rendering = await resolveRouteRenderingConfigFromFile(mod, modulePath);
      return rendering.revalidate;
    } catch {
      return undefined;
    }
  }
}

/** A page's directory pattern when route groups make it differ from its URL pattern. */
function getPageDirectoryField(route: ParsedRoute, pattern: string): { directory?: string } {
  const directory = createRouteDirectoryPattern(route);
  return directory === pattern ? {} : { directory };
}

export function interpolateRedirectDestination(
  destination: string,
  params: Record<string, string>,
): string {
  let result = destination;

  for (const [key, value] of Object.entries(params)) {
    // Longest token first: [[...key]] contains [...key], which contains [key].
    result = replaceAll(result, `[[...${key}]]`, value);
    result = replaceAll(result, `[...${key}]`, value);
    result = replaceAll(result, `[${key}]`, value);
    result = replaceAll(result, `:${key}*`, value);
    result = replaceAll(result, `:${key}`, value);
  }

  return result;
}

function getMetadataImageSuffix(pathname: string): {
  kind: MetadataImageKind;
  fileName: MetadataImageEntry["fileName"];
} | null {
  if (pathname === "/opengraph-image" || pathname.endsWith("/opengraph-image")) {
    return { kind: "opengraph", fileName: "opengraph-image" };
  }

  if (pathname === "/twitter-image" || pathname.endsWith("/twitter-image")) {
    return { kind: "twitter", fileName: "twitter-image" };
  }

  return null;
}

function getApplicationMetadataRouteDescriptor(fileName: string): {
  kind: ApplicationMetadataRouteKind;
  fileName: ApplicationMetadataRouteEntry["fileName"];
  outputName: ApplicationMetadataRouteEntry["outputName"];
} | null {
  if (fileName === "sitemap") {
    return { kind: "sitemap", fileName: "sitemap", outputName: "sitemap.xml" };
  }
  if (fileName === "robots") {
    return { kind: "robots", fileName: "robots", outputName: "robots.txt" };
  }
  if (fileName === "manifest") {
    return { kind: "manifest", fileName: "manifest", outputName: "manifest.webmanifest" };
  }
  if (fileName === "llms") {
    return { kind: "llms", fileName: "llms", outputName: "llms.txt" };
  }
  if (fileName === "llms-full") {
    return { kind: "llms-full", fileName: "llms-full", outputName: "llms-full.txt" };
  }
  return null;
}

function getApplicationMetadataRouteSuffix(pathname: string): {
  kind: ApplicationMetadataRouteKind;
  outputName: ApplicationMetadataRouteEntry["outputName"];
} | null {
  for (const fileName of ["sitemap", "robots", "manifest", "llms", "llms-full"] as const) {
    const descriptor = getApplicationMetadataRouteDescriptor(fileName)!;
    if (
      pathname === `/${descriptor.outputName}` ||
      pathname.endsWith(`/${descriptor.outputName}`)
    ) {
      return { kind: descriptor.kind, outputName: descriptor.outputName };
    }
  }
  return null;
}

function routeSegmentsToPath(
  segments: ParsedRoute["segments"],
  params: Record<string, string>,
): string {
  if (segments.length === 0) return "/";

  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment.isDynamic) {
      parts.push(segment.segment);
      continue;
    }

    const value = params[segment.segment];
    if (!value && segment.isOptional) continue;
    if (!value) {
      parts.push(`[${segment.segment}]`);
      continue;
    }

    parts.push(...value.split("/").map((part) => encodeURIComponent(part)));
  }

  return `/${parts.join("/")}`;
}

function replaceAll(input: string, search: string, replacement: string): string {
  return input.split(search).join(replacement);
}

async function safeGlobFiles(pattern: string, cwd: string): Promise<string[]> {
  try {
    return await globFiles(pattern, cwd);
  } catch {
    return [];
  }
}
