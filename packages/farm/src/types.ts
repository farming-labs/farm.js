import type { ReactNode, ComponentType } from "react";
import type { IncomingMessage, ServerResponse } from "http";
import type { FarmStorageUserConfig } from "./storage/types";
import type { FarmIntegrationsUserConfig } from "./integrations";
import type { FarmDocsResolvedConfig, FarmDocsUserConfig } from "./docs/types";
import type { FarmMarkdownResolvedConfig, FarmMarkdownUserConfig } from "./markdown";
import type { FarmMdxResolvedConfig, FarmMdxUserConfig } from "./app-markdown";
import type { FarmObservabilityUserConfig } from "./observability";
import type { FarmMiddlewareConfig } from "./middleware/types";
import type { FarmWorkflowsUserConfig } from "./workflows";
import type { FarmCronResolvedConfig, FarmCronUserConfig } from "./cron";
import type { FarmEnvConfig, ResolvedFarmEnv } from "./env";
import type { FarmRouteRules } from "./route-rules";
import type { FarmServerActionsConfig } from "./server-action-security";
import type { FarmLayerEntry, ResolvedFarmLayer } from "./layers";
import type { FarmRouteMaxDuration, FarmRouteRegions, FarmRouteRuntime } from "./route-runtime";

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
  srcDir?: string;
  extends?: readonly FarmLayerEntry[];
  /** Resolved layer graph. Populated by config resolution. */
  layers?: readonly ResolvedFarmLayer[];
  outDir?: string;
  basePath?: string;
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
  integrations?: FarmIntegrationsUserConfig;
  migrations?: FarmMigrationsUserConfig;
  /** Map portable cron schedules to ordinary GET API routes. */
  cron?: FarmCronUserConfig | FarmCronResolvedConfig | false;
  workflows?: FarmWorkflowsUserConfig | boolean;
  env?: FarmEnvConfig<any, any> | ResolvedFarmEnv;
  middleware?: FarmMiddlewareConfig;
  routeRules?: FarmRouteRules;
  context?: FarmContextFactory<any>;
  serverActions?: FarmServerActionsConfig;
  /** Build identifier used to detect stale clients during rolling deployments. */
  deploymentId?: string;
  docs?: FarmDocsUserConfig | FarmDocsResolvedConfig;
  md?: FarmMarkdownUserConfig | FarmMarkdownResolvedConfig | boolean;
  mdx?: FarmMdxUserConfig | FarmMdxResolvedConfig;
  observability?: FarmObservabilityUserConfig;
  /**
   * When true, Link href is not strictly typed (accepts any string).
   * Use when you want to skip route-type errors on Link or don't use generated route types.
   */
  suppressLintOnLink?: boolean;
  experimental?: {
    serverComponents?: boolean;
    serverActions?: boolean;
  };
  vite?: any;
}

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
export interface PageProps {
  params: Record<string, string>;
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

export interface LoadingProps {
  params: Record<string, string>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  search?: Record<string, string | string[] | undefined>;
  path: string;
  middleware?: MiddlewareProps;
  context?: PluginContextProps;
}

export interface ErrorProps extends LoadingProps {
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
export type PagePropsWithMiddleware<T extends Record<string, any>> = PageProps & {
  middleware: {
    data: Map<keyof T, T[keyof T]>;
  };
};

export interface LayoutProps {
  children: ReactNode;
  params: Record<string, string>;
}

export type Page = ComponentType<PageProps>;
export type Layout = ComponentType<LayoutProps>;
export type Loading = ComponentType<LoadingProps>;
export type ErrorBoundary = ComponentType<ErrorProps>;
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
export interface RouteModule {
  default?: Page;
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
  getStaticPaths?: () => Promise<Record<string, string>[]> | Record<string, string>[];
  /**
   * @deprecated Use getStaticPaths instead
   */
  generateStaticParams?: () => Promise<Record<string, string>[]> | Record<string, string>[];
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: (props: PageProps) => Promise<Metadata> | Metadata;
}

export interface LayoutModule {
  default: Layout;
  runtime?: FarmRouteRuntime;
  regions?: FarmRouteRegions;
  maxDuration?: FarmRouteMaxDuration;
  metadata?: Metadata & Record<string, any>;
  generateMetadata?: (props: { params: Record<string, string> }) => Promise<Metadata> | Metadata;
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

export interface FarmPlugin {
  name: string;
  setup?: (config: FarmConfig) => void | Promise<void>;
  buildStart?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
}
