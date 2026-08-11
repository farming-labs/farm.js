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
  resolveAppPath,
  globFiles,
  logger,
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
  createLayoutModuleFromProgrammaticLayout,
  createProgrammaticRouteModuleId,
  createRouteModuleFromProgrammaticPage,
  getProgrammaticRouteSearchClientOptions,
  parseProgrammaticRoutePath,
} from "../routes";
import { loadProgrammaticRouteManifests } from "../routes.server";
import {
  createFarmMarkdownRouteModuleFromFile,
  isFarmMarkdownPageFile,
  loadFarmMdxComponents,
  resolveMdxConfig,
} from "../app-markdown";
import path from "path";
import type { ViteDevServer } from "vite";
import { getClientModuleMetadata } from "../utils/client-component";
import type { MetadataImageKind } from "../metadata";
import type { FarmIslandStrategy } from "../island";
import {
  createFarmRouteRenderPlan,
  type FarmRouteRenderPlan,
} from "../navigation/render-plan";
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
import { createRouteSlotContainerId, parseRouteSlotFile } from "./route-slots";

interface RouteEntry {
  route: ParsedRoute;
  modulePath: string;
  markdownSourcePath?: string;
  pattern: string;
  source?: "file" | "programmatic";
  sourceRoot: string;
}

export interface RouteSlotEntry extends RouteEntry {
  name: string;
  ownerPattern: string;
  interception: boolean;
  fallback: boolean;
  containerId: string;
}

export interface MatchedRouteSlot {
  name: string;
  ownerPattern: string;
  containerId: string;
  interception: boolean;
  fallback: boolean;
  route: RouteSlotEntry;
  params: Record<string, string>;
}

export interface FarmClientRouteManifest {
  routes: Array<{
    pattern: string;
    modulePath: string;
    shouldHydrate: boolean;
    isClientComponent: boolean;
    islandStrategy: FarmIslandStrategy | null;
    renderPlan: FarmRouteRenderPlan;
    suppressedAsyncHydration?: true;
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

interface RedirectEntry {
  route: ParsedRoute;
  pattern: string;
  definition: ProgrammaticRedirectRoute;
}

function routeSpecificity(entry: RouteEntry): number {
  return entry.route.segments.reduce((score, segment) => {
    if (!segment.isDynamic) return score + 100;
    if (!segment.isCatchAll) return score + 50;
    return score + (segment.isOptional ? 5 : 10);
  }, entry.route.segments.length);
}

/**
 * Manages route discovery and matching for the Farm.js application
 */
export class RouteManager {
  private config: Required<FarmConfig>;
  private routes: Map<string, RouteEntry> = new Map();
  private layouts: Map<string, RouteEntry> = new Map();
  private routeSlots: Map<string, RouteSlotEntry> = new Map();
  private loadings: Map<string, RouteEntry> = new Map();
  private errors: Map<string, RouteEntry> = new Map();
  private metadataImages: Map<string, MetadataImageEntry> = new Map();
  private redirects: Map<string, RedirectEntry> = new Map();
  private programmaticPages: Map<string, ProgrammaticPageRoute> = new Map();
  private programmaticLayouts: Map<string, ProgrammaticLayoutRoute> = new Map();
  private viteServer?: ViteDevServer;
  private clientManifestCache?: {
    projectRoot: string;
    manifest: FarmClientRouteManifest;
  };

  constructor(config: Required<FarmConfig>, viteServer?: ViteDevServer) {
    this.config = config;
    this.viteServer = viteServer;
  }

  /**
   * Discover all routes in the app directory
   */
  async discoverRoutes(): Promise<void> {
    this.invalidateClientManifest();
    this.routes.clear();
    this.layouts.clear();
    this.routeSlots.clear();
    this.loadings.clear();
    this.errors.clear();
    this.metadataImages.clear();
    this.redirects.clear();
    this.programmaticPages.clear();
    this.programmaticLayouts.clear();

    for (const source of getFarmSourceRoots(this.config)) {
      await this.discoverFileRoutes(source);
      await this.discoverProgrammaticRoutes(source);
    }

    for (const slot of this.routeSlots.values()) {
      if (slot.interception && !this.routes.has(slot.pattern)) {
        throw new Error(
          `Intercepting route slot "${slot.name}" targets "${slot.pattern}", but no canonical page exists for that URL`,
        );
      }
    }

    this.routes = new Map(
      Array.from(this.routes.entries()).sort(
        ([, left], [, right]) => routeSpecificity(right) - routeSpecificity(left),
      ),
    );

    // Silent discovery - only log if verbose mode enabled
    if (process.env.FARM_VERBOSE) {
      logger.info(`Discovered ${this.routes.size} pages and ${this.layouts.size} layouts`);
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
    // Find matching page route
    let matchedRoute: RouteEntry | null = null;
    let params: Record<string, string> = {};

    for (const routeEntry of this.routes.values()) {
      const match = matchRoute(normalizedPath, routeEntry.route.segments);
      if (match.matches) {
        matchedRoute = routeEntry;
        params = match.params;
        break;
      }
    }

    // Find all matching layouts (from root to specific)
    const layouts = this.findMatchingLayouts(normalizedPath);
    const slots = this.findMatchingRouteSlots(normalizedPath, options.interceptFrom);

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
    const layouts = this.findMatchingLayouts(pattern);
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

  getRedirects(): ProgrammaticRedirectRoute[] {
    return Array.from(this.redirects.values()).map((entry) => entry.definition);
  }

  matchRedirect(pathname: string): {
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
        destination: this.localizeRedirectDestination(
          interpolateRedirectDestination(redirectEntry.definition.destination, match.params),
          localeMatch?.locale,
        ),
        statusCode,
        params: match.params,
      };
    }

    return null;
  }

  /**
   * Return the nearest matching loading boundary for a pathname.
   */
  getMatchingLoading(pathname: string): RouteEntry | null {
    return this.findNearestBoundary(this.toRoutePathname(pathname), this.loadings);
  }

  /**
   * Return the nearest matching error boundary for a pathname.
   */
  getMatchingError(pathname: string): RouteEntry | null {
    return this.findNearestBoundary(this.toRoutePathname(pathname), this.errors);
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
      if (
        absolutePath === normalizedProjectRoot ||
        absolutePath.startsWith(`${normalizedProjectRoot}${path.sep}`)
      ) {
        return absolutePath.slice(normalizedProjectRoot.length);
      }
      if (path.isAbsolute(absolutePath)) {
        const normalized = absolutePath.replace(/\\/g, "/");
        return normalized.startsWith("/") ? `/@fs${normalized}` : `/@fs/${normalized}`;
      }
      return absolutePath;
    };

    const layoutEntries = Array.from(this.layouts.values()).map((entry) => ({
      entry,
      metadata: getClientModuleMetadata(entry.modulePath, normalizedProjectRoot),
    }));

    const routes = Array.from(this.routes.values()).map((entry) => {
      const metadata = getClientModuleMetadata(entry.modulePath, normalizedProjectRoot);
      const programmaticPage = this.programmaticPages.get(entry.modulePath);
      const layoutShouldHydrate = layoutEntries.some(
        ({ entry: layout, metadata: layoutMetadata }) =>
          layoutMetadata.shouldHydrate &&
          (layout.pattern === "/" ||
            entry.pattern === layout.pattern ||
            entry.pattern.startsWith(`${layout.pattern.replace(/\/$/, "")}/`)),
      );
      return {
        pattern: entry.pattern,
        modulePath: toUrlPath(entry.modulePath),
        shouldHydrate: metadata.shouldHydrate,
        isClientComponent: metadata.isClientComponent,
        islandStrategy: metadata.islandStrategy,
        renderPlan: createFarmRouteRenderPlan({
          pageShouldHydrate: metadata.shouldHydrate,
          layoutShouldHydrate,
          islandStrategy: metadata.islandStrategy,
        }),
        suppressedAsyncHydration: metadata.suppressedAsyncHydration,
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

    const manifest = { routes, layouts, slots };
    this.clientManifestCache = {
      projectRoot: normalizedProjectRoot,
      manifest,
    };
    return manifest;
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
        return createRouteModuleFromProgrammaticPage(programmaticPage);
      }

      if (isFarmMarkdownPageFile(modulePath)) {
        const mdxConfig = resolveMdxConfig(this.config.mdx);
        const components = await loadFarmMdxComponents(mdxConfig, {
          root: this.config.root,
          loadModule: this.viteServer
            ? (componentModulePath) => this.viteServer!.ssrLoadModule(componentModulePath)
            : undefined,
        });
        return await createFarmMarkdownRouteModuleFromFile(modulePath, {
          components,
          config: mdxConfig,
        });
      }

      if (this.viteServer) {
        const module = await this.viteServer.ssrLoadModule(modulePath);
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
        return createLayoutModuleFromProgrammaticLayout(programmaticLayout) as LayoutModule;
      }

      if (this.viteServer) {
        const module = await this.viteServer.ssrLoadModule(modulePath);
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

    return (
      "/" +
      route.segments
        .map((segment) => {
          if (!segment.isDynamic) return segment.segment;

          if (segment.isCatchAll) {
            return segment.isOptional ? `[[...${segment.segment}]]` : `[...${segment.segment}]`;
          }

          return `[${segment.segment}]`;
        })
        .join("/")
    );
  }

  private async discoverFileRoutes(source: FarmSourceRoot): Promise<void> {
    const appDir = resolveAppPath(source.root, source.srcDir, "app");
    const pageFiles = await safeGlobFiles("**/page.{ts,tsx,js,jsx,md,mdx}", appDir);
    const slotDefaultFiles = await safeGlobFiles("**/@*/**/default.{ts,tsx,js,jsx}", appDir);
    const layoutFiles = await safeGlobFiles("**/layout.{ts,tsx,js,jsx}", appDir);
    const loadingFiles = await safeGlobFiles("**/loading.{ts,tsx,js,jsx}", appDir);
    const errorFiles = await safeGlobFiles("**/error.{ts,tsx,js,jsx}", appDir);
    const metadataImageFiles = await safeGlobFiles(
      "**/{opengraph-image,twitter-image}.{ts,tsx,js,jsx,png,jpg,jpeg,gif,webp}",
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
      this.routes.set(pattern, {
        route: group.route,
        modulePath,
        ...(markdownFile
          ? {
              markdownSourcePath: path.join(appDir, markdownFile),
            }
          : {}),
        pattern,
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
        const pattern = this.createRoutePattern(route);
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
          this.routes.set(pattern, {
            route,
            modulePath,
            pattern,
            source: "programmatic",
            sourceRoot: source.root,
          });
        }

        if (definition.kind === "layout") {
          const route = parseProgrammaticRoutePath(definition.path, "layout");
          const pattern = this.createRoutePattern(route);
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
      return await this.viteServer.ssrLoadModule(toViteModuleId(filePath, viteRoot));
    }

    const fileUrl = `file://${filePath}`;
    return await import(/* @vite-ignore */ fileUrl);
  }

  /**
   * Find all layouts that should wrap a given path
   */
  private findMatchingLayouts(pathname: string): RouteEntry[] {
    const matchingLayouts: RouteEntry[] = [];
    const pathSegments = pathname.split("/").filter(Boolean);

    const sortedLayouts = Array.from(this.layouts.values()).sort((a, b) => {
      return a.route.segments.length - b.route.segments.length;
    });

    for (const layoutEntry of sortedLayouts) {
      if (layoutEntry.route.segments.length > pathSegments.length) {
        continue;
      }

      let matches = true;
      for (let i = 0; i < layoutEntry.route.segments.length; i++) {
        const segment = layoutEntry.route.segments[i];
        if (!segment.isDynamic && segment.segment !== pathSegments[i]) {
          matches = false;
          break;
        }
      }

      if (matches) {
        matchingLayouts.push(layoutEntry);
      }
    }

    return matchingLayouts;
  }

  private findMatchingRouteSlots(pathname: string, interceptFrom?: string): MatchedRouteSlot[] {
    const groups = new Map<string, RouteSlotEntry[]>();
    for (const entry of this.routeSlots.values()) {
      if (!this.matchesRoutePrefix(pathname, entry.ownerPattern)) continue;
      const key = `${entry.ownerPattern}:${entry.name}`;
      const entries = groups.get(key) ?? [];
      entries.push(entry);
      groups.set(key, entries);
    }

    const normalizedFrom = interceptFrom
      ? this.toRoutePathname(new URL(interceptFrom, "http://farm.local").pathname)
      : undefined;
    const matches: MatchedRouteSlot[] = [];

    for (const entries of groups.values()) {
      const candidates = entries
        .filter((entry) => !entry.fallback)
        .filter(
          (entry) =>
            !entry.interception ||
            (normalizedFrom !== undefined &&
              this.matchesRoutePrefix(normalizedFrom, entry.ownerPattern)),
        )
        .map((entry) => ({
          entry,
          match: matchRoute(pathname, entry.route.segments),
        }))
        .filter((candidate) => candidate.match.matches)
        .sort((left, right) => {
          if (left.entry.interception !== right.entry.interception) {
            return left.entry.interception ? -1 : 1;
          }
          return routeSpecificity(right.entry) - routeSpecificity(left.entry);
        });

      const selected = candidates[0];
      if (selected) {
        matches.push({
          name: selected.entry.name,
          ownerPattern: selected.entry.ownerPattern,
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

  private matchesRoutePrefix(pathname: string, pattern: string): boolean {
    if (pattern === "/") return true;
    const patternSegments = parseRoutePath(`${pattern}/page.tsx`).segments;
    const pathSegments = pathname.split("/").filter(Boolean);
    if (patternSegments.length > pathSegments.length) return false;

    for (let index = 0; index < patternSegments.length; index++) {
      const segment = patternSegments[index]!;
      if (!segment.isDynamic && segment.segment !== pathSegments[index]) return false;
    }
    return true;
  }

  private findNearestBoundary(
    pathname: string,
    boundaries: Map<string, RouteEntry>,
  ): RouteEntry | null {
    const normalizedPath = pathname === "/" ? "/" : pathname.replace(/\/$/, "");
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    let bestMatch: RouteEntry | null = null;

    for (const boundaryEntry of boundaries.values()) {
      if (boundaryEntry.route.segments.length > pathSegments.length) {
        continue;
      }

      let matches = true;
      for (let i = 0; i < boundaryEntry.route.segments.length; i++) {
        const segment = boundaryEntry.route.segments[i];
        const pathSegment = pathSegments[i];

        if (!pathSegment) {
          matches = false;
          break;
        }

        if (!segment.isDynamic && segment.segment !== pathSegment) {
          matches = false;
          break;
        }
      }

      if (!matches) {
        continue;
      }

      if (!bestMatch || boundaryEntry.route.segments.length > bestMatch.route.segments.length) {
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
    return i18n ? stripFarmLocaleFromPathname(pathname, i18n) : pathname;
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

function interpolateRedirectDestination(
  destination: string,
  params: Record<string, string>,
): string {
  let result = destination;

  for (const [key, value] of Object.entries(params)) {
    result = replaceAll(result, `[...${key}]`, value);
    result = replaceAll(result, `[[...${key}]]`, value);
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
