import type { ReactNode, ComponentType } from 'react';
import type { IncomingMessage, ServerResponse } from 'http';

export type NitroPreset = 
  | 'node-server'
  | 'vercel'
  | 'cloudflare'
  | 'cloudflare-pages'
  | 'netlify'
  | 'netlify-edge'
  | 'bun'
  | 'deno'
  | 'azure'
  | 'aws-lambda'
  | 'firebase'
  | 'custom'
  | 'self-host'
  | 'farm'
  | string;

export interface FarmConfig {
  root?: string;
  srcDir?: string;
  outDir?: string;
  basePath?: string;
  preset?: NitroPreset;
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
 * Page component props
 * 
 * @param params - Dynamic route parameters (e.g., { id: '123' } for /users/[id])
 * @param searchParams - URL search/query parameters
 * @param path - Current pathname
 * @param middleware - Data set by middleware.ts (optional, available if middleware exists)
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
export interface RouteModule {
  default?: Page;
  generateStaticParams?: () => Promise<Record<string, string>[]> | Record<string, string>[];
  generateMetadata?: (props: PageProps) => Promise<Metadata> | Metadata;
}

export interface LayoutModule {
  default: Layout;
  generateMetadata?: (props: { params: Record<string, string> }) => Promise<Metadata> | Metadata;
}

export interface Metadata {
  title?: string | { default?: string; template?: string };
  description?: string;
  keywords?: string | string[];
  authors?: Array<{ name: string; url?: string }>;
  creator?: string;
  publisher?: string;
  robots?: string | { index?: boolean; follow?: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    url?: string;
    siteName?: string;
    images?: Array<{
      url: string;
      width?: number;
      height?: number;
      alt?: string;
    }>;
    type?: string;
  };
  twitter?: {
    card?: 'summary' | 'summary_large_image' | 'app' | 'player';
    site?: string;
    creator?: string;
    title?: string;
    description?: string;
    images?: string | string[];
  };
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
  type: 'page' | 'layout' | 'loading' | 'error' | 'not-found';
}

export interface BuildOptions {
  mode: 'development' | 'production';
  ssr: boolean;
  minify: boolean;
  sourcemap: boolean;
}

export interface FarmPlugin {
  name: string;
  setup?: (config: FarmConfig) => void | Promise<void>;
  buildStart?: () => void | Promise<void>;
  buildEnd?: () => void | Promise<void>;
}
