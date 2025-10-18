import type { ReactNode, ComponentType } from 'react';
import type { IncomingMessage, ServerResponse } from 'http';

export interface FarmConfig {
  root?: string;
  srcDir?: string;
  outDir?: string;
  basePath?: string;
  experimental?: {
    serverComponents?: boolean;
    serverActions?: boolean;
  };
  vite?: any;
}

export interface PageProps {
  params: Record<string, string>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  path: string
}
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
