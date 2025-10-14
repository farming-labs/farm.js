import type { FarmConfig as BaseFarmConfig } from './types';
import type { FarmPlugin } from './plugin';
import type { UserConfig as ViteUserConfig } from 'vite';

export interface RedirectConfig {
  source: string;
  destination: string;
  permanent?: boolean;
  statusCode?: number;
}

export interface HeaderConfig {
  source: string;
  headers: Array<{
    key: string;
    value: string;
  }>;
}

export interface RewriteConfig {
  source: string;
  destination: string;
}

export interface ImageConfig {
  domains?: string[];
  deviceSizes?: number[];
  imageSizes?: number[];
  formats?: ('image/avif' | 'image/webp')[];
  minimumCacheTTL?: number;
}

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  localeDetection?: boolean;
}

export interface MiddlewareConfig {
  matcher?: string | string[];
}

export interface FarmUserConfig extends Omit<BaseFarmConfig, 'vite'> {
  plugins?: FarmPlugin[];

  trailingSlash?: boolean;
  redirects?: () => Promise<RedirectConfig[]> | RedirectConfig[];
  rewrites?: () => Promise<RewriteConfig[]> | RewriteConfig[];
  headers?: () => Promise<HeaderConfig[]> | HeaderConfig[];

  images?: ImageConfig;
  publicDir?: string;

  i18n?: I18nConfig;

  middleware?: MiddlewareConfig;

  output?: 'standalone' | 'static' | 'export';
  distDir?: string;
  generateBuildId?: () => string | Promise<string>;
  compress?: boolean;

  devIndicators?: {
    buildActivity?: boolean;
    buildActivityPosition?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  };

  serverRuntimeConfig?: Record<string, any>;
  publicRuntimeConfig?: Record<string, any>;

  env?: Record<string, string>;

  typescript?: {
    tsconfigPath?: string;
    ignoreBuildErrors?: boolean;
  };

  vite?: ViteUserConfig | ((config: ViteUserConfig) => ViteUserConfig);

  [key: string]: any;
}

export interface ResolvedFarmConfig extends Required<Omit<FarmUserConfig, 'plugins' | 'vite'>> {
  plugins: FarmPlugin[];
  vite: ViteUserConfig;
}

export function defineFarmConfig(config: FarmUserConfig): FarmUserConfig {
  return config;
}

export async function resolveConfig(
  userConfig: FarmUserConfig,
  mode: 'development' | 'production'
): Promise<ResolvedFarmConfig> {
  const isDev = mode === 'development';

  const redirects =
    typeof userConfig.redirects === 'function'
      ? await userConfig.redirects()
      : userConfig.redirects || [];

  const rewrites =
    typeof userConfig.rewrites === 'function'
      ? await userConfig.rewrites()
      : userConfig.rewrites || [];

  const headers =
    typeof userConfig.headers === 'function'
      ? await userConfig.headers()
      : userConfig.headers || [];

  const resolved: ResolvedFarmConfig = {
    root: userConfig.root || process.cwd(),
    srcDir: userConfig.srcDir || 'src',
    outDir: userConfig.outDir || 'dist',
    basePath: userConfig.basePath || '/',
    experimental: {
      serverComponents: true,
      serverActions: true,
      ...userConfig.experimental,
    },
    plugins: userConfig.plugins || [],
    trailingSlash: userConfig.trailingSlash ?? false,
    redirects: () => redirects,
    rewrites: () => rewrites,
    headers: () => headers,
    images: {
      domains: [],
      deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
      imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
      formats: ['image/webp'],
      minimumCacheTTL: 60,
      ...userConfig.images,
    },
    publicDir: userConfig.publicDir || 'public',
    i18n: userConfig.i18n,
    middleware: userConfig.middleware || {},
    output: userConfig.output || 'standalone',
    distDir: userConfig.distDir || '.farm',
    generateBuildId: userConfig.generateBuildId || (() => `build-${Date.now()}`),
    compress: userConfig.compress ?? true,
    devIndicators: {
      buildActivity: true,
      buildActivityPosition: 'bottom-right',
      ...userConfig.devIndicators,
    },
    serverRuntimeConfig: userConfig.serverRuntimeConfig || {},
    publicRuntimeConfig: userConfig.publicRuntimeConfig || {},
    env: { ...process.env, ...userConfig.env },
    typescript: {
      tsconfigPath: 'tsconfig.json',
      ignoreBuildErrors: false,
      ...userConfig.typescript,
    },
    vite: typeof userConfig.vite === 'function' ? userConfig.vite({}) : userConfig.vite || {},
  };

  return resolved;
}

export async function loadConfig(
  rootDir?: string,
  configPath?: string
): Promise<FarmUserConfig | undefined> {
  const root = rootDir || process.cwd();
  const searchPaths = [configPath, 'farm.config.ts', 'farm.config.js', 'farm.config.mjs'].filter(
    Boolean
  ) as string[];

  for (const relativePath of searchPaths) {
    try {
      // Resolve absolute path
      const absolutePath = relativePath.startsWith('/') ? relativePath : `${root}/${relativePath}`;

      // Add timestamp to avoid caching during dev
      const moduleUrl = `file://${absolutePath}?t=${Date.now()}`;
      const config = await import(moduleUrl);

      return config.default || config;
    } catch (error) {
      // Config file not found or error loading, continue
      continue;
    }
  }

  return undefined;
}
