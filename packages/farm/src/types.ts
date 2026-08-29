import type { FarmRenderer } from "./renderer";
import type { IncomingMessage, ServerResponse } from "http";
import type { FarmStorageUserConfig } from "./storage/types";
import type { FarmIntegrationsUserConfig } from "./integrations";
import type { FarmDocsResolvedConfig, FarmDocsUserConfig } from "./docs/types";
import type { FarmMarkdownResolvedConfig, FarmMarkdownUserConfig } from "./markdown";
import type { FarmMdxResolvedConfig, FarmMdxUserConfig } from "./app-markdown-config";
import type { FarmObservabilityUserConfig } from "./observability";
import type { FarmMiddlewareConfig } from "./middleware/types";
import type { FarmWorkflowsUserConfig } from "./workflows";
import type { FarmCronResolvedConfig, FarmCronUserConfig } from "./cron";
import type { FarmEnvConfig, ResolvedFarmEnv } from "./env";
import type { FarmRouteRules } from "./route-rules";
import type { FarmServerActionsConfig } from "./server-action-security";
import type { FarmServerConfig } from "./server-http";
import type { FarmLayerEntry, ResolvedFarmLayer } from "./layers";
import type { FarmRouteMaxDuration, FarmRouteRegions, FarmRouteRuntime } from "./route-runtime";
import type { FarmDevtoolsUserConfig } from "./devtools-config";
import type { FarmImageConfig } from "./image-config";
import type { FarmPlugin } from "./plugin";
import type { FarmI18nUserConfig, ResolvedFarmI18nConfig } from "./i18n/types";
import type { FarmCacheUserConfig } from "./cache";
import type { FarmAuthUserConfig, ResolvedFarmAuthConfig } from "./auth-config";
import type { FarmPerformanceConfig } from "./preload";
import type { FarmLayoutFonts } from "./font";
import type { FarmSecurityConfig, ResolvedFarmSecurityConfig } from "./security";
import type { FarmThemeConfig, ResolvedFarmThemeConfig } from "./theme/types";
import type { FarmAPIConfig } from "./api/config";

declare global {
  namespace FarmJS {
    /** @internal Application route patterns registered by generated types. */
    interface RouteRegistry {}
  }
}

/** A renderer-neutral component accepted by Farm's file-system router. */
export type FarmComponentType<TProps = Record<string, unknown>> =
  | ((props: TProps) => any)
  | (new (props: TProps) => any);

/** All generated route module patterns for the current application. */
export type AppRoutePattern = FarmJS.RouteRegistry extends {
  pattern: infer TPattern extends string;
}
  ? TPattern
  : string;

type FarmRoutePropsDefault = never;

type FarmRoutePropsTarget = AppRoutePattern;

type StripPageRouteSuffix<TRoute extends string> = TRoute extends `${infer TPath}?${string}`
  ? StripPageRouteSuffix<TPath>
  : TRoute extends `${infer TPath}#${string}`
    ? StripPageRouteSuffix<TPath>
    : TRoute;

type SimplifyPageRouteParams<TValue> = { [TKey in keyof TValue]: TValue[TKey] } & {};

type PageRouteSegmentParams<TSegment extends string> = TSegment extends `[[...${infer TParam}]]`
  ? { [TKey in TParam]?: string }
  : TSegment extends `[...${infer TParam}]`
    ? { [TKey in TParam]: string }
    : TSegment extends `[${infer TParam}]`
      ? { [TKey in TParam]: string }
      : {};

type ExtractPageRouteParams<TRoute extends string> =
  TRoute extends `${infer TSegment}/${infer TRest}`
    ? PageRouteSegmentParams<TSegment> & ExtractPageRouteParams<TRest>
    : PageRouteSegmentParams<TRoute>;

/** Infer the decoded params received by a page from a route pattern. */
export type PageRouteParams<TRoute extends string> = string extends TRoute
  ? Record<string, string>
  : TRoute extends string
    ? SimplifyPageRouteParams<ExtractPageRouteParams<StripPageRouteSuffix<TRoute>>>
    : never;

type ResolvePageRouteParams<TRoute extends FarmRoutePropsTarget> = [TRoute] extends [never]
  ? Record<string, string>
  : TRoute extends string
    ? PageRouteParams<TRoute>
    : Record<string, string>;

export type NitroPreset =
  | "node-server"
  | "vercel"
  | "cloudflare"
  | "cloudflare-pages"
  | "netlify"
  | "netlify-edge"
  | "bun"
  | "deno"
  | "azure"
  | "aws-lambda"
  | "firebase"
  | "custom"
  | "self-host"
  | "farm"
  | string;

export type FarmMigrationCommand =
  | string
  | {
      /** Shell command to run for this migration step. */
      command: string;
      /** Optional label printed by the CLI before running the command. */
      name?: string;
      /** Working directory for this command, relative to the project root unless absolute. */
      cwd?: string;
      /** Additional environment variables for this command. */
      env?: Record<string, string | undefined>;
      /** Skip this command without removing it from config. */
      skip?: boolean;
    };

export interface FarmMigrationsConfig {
  /** One-shot commands that create or update app/integration schemas. */
  commands?: FarmMigrationCommand[];
}

export type FarmMigrationsUserConfig = FarmMigrationsConfig | FarmMigrationCommand[];

export interface ResolvedFarmMigrationsConfig {
  commands: FarmMigrationCommand[];
}

export interface FarmContextFactoryInput {
  request: Request;
  rawRequest?: FarmRequest;
  params: Record<string, string>;
  search: Record<string, string | string[] | undefined>;
  path: string;
}

export type FarmContextFactory<TContext = unknown> = (
  input: FarmContextFactoryInput,
) => TContext | Promise<TContext>;

export interface FarmAppContext {}

export interface FarmConfig {
  root?: string;
  /** App source directory. @default "src" */
  srcDir?: string;
  extends?: readonly FarmLayerEntry[];
  /** Resolved layer graph. Populated by config resolution. */
  layers?: readonly ResolvedFarmLayer[];
  outDir?: string;
  basePath?: string;
  /**
   * Component renderer used for JSX compilation, SSR, and browser hydration.
   * React is used when omitted.
   */
  renderer?: FarmRenderer;
  preset?: NitroPreset;
  deploy?: {
    target?: "vercel" | "cloudflare" | "netlify" | "node" | string;
    preset?: NitroPreset;
    outputDir?: string;
    output?: string;
    projectName?: string;
    vercel?: {
      outputDirectory?: string;
      buildCommand?: string;
      installCommand?: string;
      framework?: string | null;
    };
    cloudflare?: {
      outputDir?: string;
      projectName?: string;
    };
    netlify?: {
      outputDir?: string;
      site?: string;
    };
  };
  storage?: FarmStorageUserConfig;
  /** Shared application data, route, ISR, and PPR cache. */
  cache?: FarmCacheUserConfig;
  integrations?: FarmIntegrationsUserConfig;
  /** Farm-native authentication. `true` enables email/password auth. */
  auth?: FarmAuthUserConfig | ResolvedFarmAuthConfig;
  plugins?: FarmPlugin[];
  migrations?: FarmMigrationsUserConfig;
  /** Map portable cron schedules to ordinary GET API routes. */
  cron?: FarmCronUserConfig | FarmCronResolvedConfig | false;
  workflows?: FarmWorkflowsUserConfig | boolean;
  /** Public base URL and path used by Farm's browser API clients. */
  api?: FarmAPIConfig;
  env?: FarmEnvConfig<any, any> | ResolvedFarmEnv;
  middleware?: FarmMiddlewareConfig;
  routeRules?: FarmRouteRules;
  context?: FarmContextFactory<any>;
  /** Server ingress and trusted-proxy policy. */
  server?: FarmServerConfig;
  serverActions?: FarmServerActionsConfig;
  /** App-wide HTTP security policy. */
  security?: FarmSecurityConfig | ResolvedFarmSecurityConfig;
  images?: FarmImageConfig;
  /** Browser resource scheduling and preload budgets. */
  performance?: FarmPerformanceConfig;
  /** Built-in light, dark, and system color-mode runtime. */
  theme?: FarmThemeConfig | ResolvedFarmThemeConfig | false;
  i18n?: FarmI18nUserConfig | ResolvedFarmI18nConfig | false;
  /** Build identifier used to detect stale clients during rolling deployments. */
  deploymentId?: string;
  /** Server-only application runtime values. */
  serverRuntimeConfig?: Record<string, unknown>;
  /** Serializable application values exposed to `src/client.ts`. */
  publicRuntimeConfig?: Record<string, unknown>;
  docs?: FarmDocsUserConfig | FarmDocsResolvedConfig;
  md?: FarmMarkdownUserConfig | FarmMarkdownResolvedConfig | boolean;
  mdx?: FarmMdxUserConfig | FarmMdxResolvedConfig;
  observability?: FarmObservabilityUserConfig;
  /** Development-only runtime inspector. Enabled by default during `farm dev`. */
  devtools?: FarmDevtoolsUserConfig;
  /**
   * When true, Link href is not strictly typed (accepts any string).
   * Use when you want to skip route-type errors on Link or don't use generated route types.
   */
  suppressLintOnLink?: boolean;
  experimental?: {
    serverComponents?: boolean;
    serverActions?: boolean;
    /**
     * Controls non-RSC hydration ownership for server modules that import
     * leaf `"use client"` components.
     *
     * - `"off"` keeps the current route-wide hydration boundary.
     * - `"analyze"` reports eligible boundaries without changing runtime behavior.
     * - `"enabled"` hydrates eligible client leaves independently and falls
     *   back to route-wide hydration for unsupported module graphs.
     *
     * This does not enable React Server Components. `"use client"` remains a
     * valid client-boundary declaration in normal SSR applications.
     *
     * @experimental
     * @default "off"
     */
    isolatedClientHydration?: FarmIsolatedClientHydrationMode;
    /**
     * Automatically optimize eligible server-only host-element subtrees with
     * the native Strata renderer. Unsupported trees keep normal React
     * rendering; no application boundary component is required.
     *
     * @experimental
     * @default false
     */
    optimizedBoundary?: boolean;
  };
  vite?: any;
}

export type FarmIsolatedClientHydrationMode = "off" | "analyze" | "enabled";

/**
 * Middleware data available in page components
 */
export interface MiddlewareProps {
  /**
   * Map containing all data set by middleware via ctx.data.set()
   *
   * @example
   * ```tsx
   * // In middleware.ts
   * ctx.data.set('user', { id: 1, name: 'John' });
   *
   * // In page.tsx
   * const user = props.middleware?.data.get('user');
   * ```
   */
  data: Map<string, any>;
}

/**
 * Plugin context data available in server page components.
 * Only values explicitly exposed by plugins are included.
 */
export interface PluginContextProps {
  data: Map<string, any>;
}

/**
 * Page component props
 *
 * @param params - Dynamic route parameters (e.g., { id: '123' } for /users/[id])
 * @param searchParams - URL search/query parameters
 * @param path - Current pathname
 * @param middleware - Data set by middleware.ts (optional, available if middleware exists)
 * @param context - Data explicitly exposed by plugins for this request (optional)
 */
export interface PageProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  params: ResolvePageRouteParams<TRoute>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  path: string;
  /**
   * Data from middleware.ts in the same directory or parent directories
   * Access data via props.middleware?.data.get('key')
   *
   * @example
   * ```tsx
   * export default function Page(props: PageProps) {
   *   const user = props.middleware?.data.get('user');
   *   const stats = props.middleware?.data.get('dashboardStats');
   *
   *   return <div>Welcome {user?.name}</div>;
   * }
   * ```
   */
  middleware?: MiddlewareProps;
  /**
   * Request-scoped plugin context values explicitly exposed by plugins.
   * Access data via props.context?.data.get('key').
   */
  context?: PluginContextProps;
}

export interface LoadingProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  params: ResolvePageRouteParams<TRoute>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  search?: Record<string, string | string[] | undefined>;
  path: string;
  middleware?: MiddlewareProps;
  context?: PluginContextProps;
}

export interface ErrorProps<
  TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault,
> extends LoadingProps<TRoute> {
  error: unknown;
  reset: () => void;
}

/**
 * Helper type to create typed page props with specific middleware data shape
 *
 * @example
 * ```tsx
 * interface MyMiddlewareData {
 *   user: { id: number; name: string };
 *   stats: { views: number };
 * }
 *
 * type MyPageProps = PagePropsWithMiddleware<MyMiddlewareData>;
 *
 * export default function Page(props: MyPageProps) {
 *   const user = props.middleware?.data.get('user');  // Fully typed!
 *   const stats = props.middleware?.data.get('stats');  // Fully typed!
 *
 *   return <div>Welcome {user?.name}</div>;
 * }
 * ```
 */
export type PagePropsWithMiddleware<
  T extends Record<string, any>,
  TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault,
> = PageProps<TRoute> & {
  middleware: {
    data: Map<keyof T, T[keyof T]>;
  };
};

export interface LayoutProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  children: any;
  params: ResolvePageRouteParams<TRoute>;
}

/** Props passed to a route's `generateMetadata` function. */
export type MetadataProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
  PageProps<TRoute>;

/** Props passed to a layout's `generateMetadata` function. */
export interface LayoutMetadataProps<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  params: ResolvePageRouteParams<TRoute>;
}

export type Page<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> = FarmComponentType<
  PageProps<TRoute>
>;
export type Layout<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> = FarmComponentType<
  LayoutProps<TRoute>
>;
export type Loading<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
  FarmComponentType<LoadingProps<TRoute>>;
export type ErrorBoundary<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
  FarmComponentType<ErrorProps<TRoute>>;
/**
 * Route module exports for pages
 *
 * SSR is the default - pages render on each request
 * SSG is opt-in via `export const ssg = true`, Next-compatible route
 * config exports, or a top-of-file rendering directive.
 *
 * @example SSR Page (default):
 * ```tsx
 * export default async function Page() {
 *   const data = await fetchData();
 *   return <div>{data.title}</div>;
 * }
 * ```
 *
 * @example SSG Page:
 * ```tsx
 * export const ssg = true;
 *
 * export default function AboutPage() {
 *   return <h1>About Us</h1>;
 * }
 * ```
 *
 * @example SSG with Revalidation (ISR):
 * ```tsx
 * export const ssg = true;
 * export const revalidate = 60; // Regenerate every 60 seconds
 *
 * export default async function ProductsPage() {
 *   const products = await fetchProducts();
 *   return <ProductList products={products} />;
 * }
 * ```
 *
 * @example Dynamic SSG Route:
 * ```tsx
 * export const ssg = true;
 *
 * export async function getStaticPaths() {
 *   const posts = await fetchPosts();
 *   return posts.map(post => ({ slug: post.slug }));
 * }
 *
 * export default async function BlogPost({ params }) {
 *   const post = await fetchPost(params.slug);
 *   return <article>{post.title}</article>;
 * }
 * ```
 *
 * @example Next-compatible Route Config:
 * ```tsx
 * export const dynamic = "force-static";
 * export const revalidate = 60;
 *
 * export default function DocsPage() {
 *   return <h1>Docs</h1>;
 * }
 * ```
 *
 * @example Directive Route Config:
 * ```tsx
 * "use ssg; 60";
 *
 * export default function DocsPage() {
 *   return <h1>Docs</h1>;
 * }
 * ```
 */
export interface RouteModule<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  default?: Page<TRoute>;
  /** Execution runtime for this route. Layout values are inherited unless overridden. */
  runtime?: FarmRouteRuntime;
  /** Provider-specific execution regions, or "auto" to clear an inherited value. */
  regions?: FarmRouteRegions;
  /** Maximum execution time in seconds, or "auto" to use the provider default. */
  maxDuration?: FarmRouteMaxDuration;
  /**
   * Mark this page for Static Site Generation (SSG)
   * When true, the page will be pre-rendered at build time
   */
  ssg?: boolean;
  /**
   * Revalidate interval in seconds for Incremental Static Regeneration (ISR)
   * Only applicable when ssg = true
   */
  revalidate?: number | false;
  /**
   * Next.js-compatible rendering mode.
   * - force-static/error: pre-render at build time
   * - force-dynamic: render on each request
   */
  dynamic?: "auto" | "force-static" | "force-dynamic" | "error";
  /**
   * Opt into Partial Prerendering/static-shell caching for this route.
   * Compatible with Farm's `ppr` export and Next.js `experimental_ppr`.
   */
  ppr?: boolean;
  experimental_ppr?: boolean;
  /**
   * Return all paths to pre-render for dynamic SSG routes
   * Required for dynamic routes (e.g., [slug]) when ssg = true
   */
  getStaticPaths?: GenerateStaticParams<TRoute>;
  /**
   * @deprecated Use getStaticPaths instead
   */
  generateStaticParams?: GenerateStaticParams<TRoute>;
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: (props: MetadataProps<TRoute>) => Promise<Metadata> | Metadata;
}

/** A value accepted for one static route parameter. */
export type StaticPathPrimitive = string | number | boolean;

/**
 * Parameters returned by `getStaticPaths` or `generateStaticParams`.
 * Arrays create individual URL segments for catch-all route parameters.
 */
export type StaticPathParams = Record<string, StaticPathPrimitive | readonly StaticPathPrimitive[]>;

type StaticRouteSegmentParams<TSegment extends string> = TSegment extends `[[...${infer TParam}]]`
  ? { [TKey in TParam]?: readonly StaticPathPrimitive[] }
  : TSegment extends `[...${infer TParam}]`
    ? { [TKey in TParam]: readonly StaticPathPrimitive[] }
    : TSegment extends `[${infer TParam}]`
      ? { [TKey in TParam]: StaticPathPrimitive }
      : {};

type ExtractStaticRouteParams<TRoute extends string> =
  TRoute extends `${infer TSegment}/${infer TRest}`
    ? StaticRouteSegmentParams<TSegment> & ExtractStaticRouteParams<TRest>
    : StaticRouteSegmentParams<TRoute>;

/** Infer the values accepted from `getStaticPaths` for a route pattern. */
export type StaticRouteParams<TRoute extends string> = string extends TRoute
  ? StaticPathParams
  : TRoute extends string
    ? SimplifyPageRouteParams<ExtractStaticRouteParams<StripPageRouteSuffix<TRoute>>>
    : never;

type ResolveStaticRouteParams<TRoute extends FarmRoutePropsTarget> = [TRoute] extends [never]
  ? StaticPathParams
  : TRoute extends string
    ? StaticRouteParams<TRoute>
    : StaticPathParams;

/** A route-aware `getStaticPaths` or `generateStaticParams` function. */
export type GenerateStaticParams<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> =
  () => Array<ResolveStaticRouteParams<TRoute>> | Promise<Array<ResolveStaticRouteParams<TRoute>>>;

export interface LayoutModule<TRoute extends FarmRoutePropsTarget = FarmRoutePropsDefault> {
  default: Layout<TRoute>;
  /** Semantic fonts inherited by framework-owned surfaces for this route. */
  fonts?: FarmLayoutFonts;
  runtime?: FarmRouteRuntime;
  regions?: FarmRouteRegions;
  maxDuration?: FarmRouteMaxDuration;
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: (props: LayoutMetadataProps<TRoute>) => Promise<Metadata> | Metadata;
}

export interface Metadata {
  metadataBase?: string | URL;
  title?: string | { default?: string; template?: string };
  description?: string;
  keywords?: string | string[];
  author?: string;
  authors?: Array<{ name: string; url?: string }>;
  creator?: string;
  publisher?: string;
  robots?: string | { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    images?:
      | string
      | {
          url: string;
          width?: number;
          height?: number;
          alt?: string;
          type?: string;
        }
      | Array<{
          url: string;
          width?: number;
          height?: number;
          alt?: string;
          type?: string;
        }>;
    image?: string;
    type?: string;
    locale?: string;
  };
  twitter?: {
    card?: "summary" | "summary_large_image" | "app" | "player";
    site?: string;
    creator?: string;
    title?: string;
    description?: string;
    images?:
      | string
      | {
          url: string;
          width?: number;
          height?: number;
          alt?: string;
          type?: string;
        }
      | Array<
          | string
          | {
              url: string;
              width?: number;
              height?: number;
              alt?: string;
              type?: string;
            }
        >;
  };
  alternates?: {
    canonical?: string;
    languages?: Record<string, string>;
  };
  icons?:
    | string
    | {
        icon?: string | Array<string | { url: string; sizes?: string; type?: string }>;
        shortcut?: string | Array<string | { url: string; sizes?: string; type?: string }>;
        apple?: string | Array<string | { url: string; sizes?: string; type?: string }>;
      };
  manifest?: string;
}

export interface FarmRequest extends IncomingMessage {
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  body?: any;
}

export interface FarmResponse extends ServerResponse {
  json: (data: any) => void;
  status: (code: number) => FarmResponse;
  redirect: (url: string, status?: number) => void;
}

export type ServerAction = (...args: any[]) => Promise<any>;

export interface RouteSegment {
  segment: string;
  isDynamic: boolean;
  isOptional: boolean;
  isCatchAll: boolean;
}

export interface ParsedRoute {
  segments: RouteSegment[];
  filePath: string;
  type: "page" | "layout" | "loading" | "error" | "not-found";
}

export interface BuildOptions {
  mode: "development" | "production";
  ssr: boolean;
  minify: boolean;
  sourcemap: boolean;
}

/**
 * Represents a page to be pre-rendered at build time (SSG)
 */
export interface SSGPage {
  /** The URL path for this page */
  urlPath: string;
  /** The file path to the page module */
  filePath: string;
  /** Route parameters for dynamic routes */
  params: Record<string, string>;
  /** Revalidation interval in seconds (ISR) */
  revalidate?: number;
}

/**
 * Result of SSG page collection
 */
export interface SSGCollectionResult {
  /** Pages to pre-render at build time */
  ssg: SSGPage[];
  /** Routes that will be server-rendered on each request */
  ssr: string[];
}
