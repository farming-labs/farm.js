import type { FarmConfig as BaseFarmConfig } from "./types";
import type { FarmPlugin } from "./plugin";
import type { UserConfig as ViteUserConfig } from "vite";

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
  formats?: ("image/avif" | "image/webp")[];
  minimumCacheTTL?: number;
}

export interface I18nConfig {
  locales: string[];
  defaultLocale: string;
  localeDetection?: boolean;
}

export interface OpenAPIConfig {
  enabled?: boolean;
  route?: string;
  title?: string;
  description?: string;
  version?: string;
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  contact?: {
    name?: string;
    email?: string;
    url?: string;
  };
  license?: {
    name: string;
    url?: string;
  };
}

export interface MiddlewareConfig {
  matcher?: string | string[];
}

export interface FarmUserConfig extends Omit<BaseFarmConfig, "vite"> {
  plugins?: FarmPlugin[];
  preset?: BaseFarmConfig["preset"];

  trailingSlash?: boolean;
  redirects?: () => Promise<RedirectConfig[]> | RedirectConfig[];
  rewrites?: () => Promise<RewriteConfig[]> | RewriteConfig[];
  headers?: () => Promise<HeaderConfig[]> | HeaderConfig[];

  images?: ImageConfig;
  publicDir?: string;

  i18n?: I18nConfig;
  openapi?: OpenAPIConfig;

  middleware?: MiddlewareConfig;

  output?: "standalone" | "static" | "export";
  distDir?: string;
  generateBuildId?: () => string | Promise<string>;
  compress?: boolean;

  devIndicators?: {
    buildActivity?: boolean;
    buildActivityPosition?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
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

export interface ResolvedFarmConfig extends Required<Omit<FarmUserConfig, "plugins" | "vite">> {
  plugins: FarmPlugin[];
  vite: ViteUserConfig;
}

export function defineFarmConfig(config: FarmUserConfig): FarmUserConfig {
  return config;
}

export async function resolveConfig(
  userConfig: FarmUserConfig,
  mode: "development" | "production",
): Promise<ResolvedFarmConfig> {
  const isDev = mode === "development";

  const redirects =
    typeof userConfig.redirects === "function"
      ? await userConfig.redirects()
      : userConfig.redirects || [];

  const rewrites =
    typeof userConfig.rewrites === "function"
      ? await userConfig.rewrites()
      : userConfig.rewrites || [];

  const headers =
    typeof userConfig.headers === "function"
      ? await userConfig.headers()
      : userConfig.headers || [];

  const resolved: ResolvedFarmConfig = {
    root: userConfig.root || process.cwd(),
    srcDir: userConfig.srcDir || "src",
    outDir: userConfig.outDir || "dist",
    basePath: userConfig.basePath || "/",
    preset: userConfig.preset || "node-server",
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
      formats: ["image/webp"],
      minimumCacheTTL: 60,
      ...userConfig.images,
    },
    publicDir: userConfig.publicDir || "public",
    i18n: userConfig.i18n,
    openapi: {
      enabled: false,
      route: "/docs/reference",
      title: "API Documentation",
      description: "Auto-generated API documentation",
      version: "1.0.0",
      servers: [{ url: "http://localhost:3000", description: "Development server" }],
      ...userConfig.openapi,
    },
    middleware: userConfig.middleware || {},
    output: userConfig.output || "standalone",
    distDir: userConfig.distDir || ".farm",
    generateBuildId: userConfig.generateBuildId || (() => `build-${Date.now()}`),
    compress: userConfig.compress ?? true,
    devIndicators: {
      buildActivity: true,
      buildActivityPosition: "bottom-right",
      ...userConfig.devIndicators,
    },
    serverRuntimeConfig: userConfig.serverRuntimeConfig || {},
    publicRuntimeConfig: userConfig.publicRuntimeConfig || {},
    env: { ...process.env, ...userConfig.env },
    typescript: {
      tsconfigPath: "tsconfig.json",
      ignoreBuildErrors: false,
      ...userConfig.typescript,
    },
    vite: typeof userConfig.vite === "function" ? userConfig.vite({}) : userConfig.vite || {},
  };

  return resolved;
}

export async function loadConfig(
  rootDir?: string,
  configPath?: string,
): Promise<FarmUserConfig | undefined> {
  const path = await import("path");
  const { pathToFileURL } = await import("url");
  const { existsSync } = await import("fs");

  const root = rootDir || process.cwd();
  const searchPaths = [configPath, "farm.config.ts", "farm.config.js", "farm.config.mjs"].filter(
    Boolean,
  ) as string[];

  for (const relativePath of searchPaths) {
    try {
      // Use path.join for proper path construction
      const absolutePath = relativePath.startsWith("/")
        ? relativePath
        : path.join(root, relativePath);

      // Normalize the path to handle any issues
      const normalizedPath = path.resolve(absolutePath);

      // Check if file exists before trying to import
      if (!existsSync(normalizedPath)) {
        continue;
      }

      // Use pathToFileURL for proper file:// URL conversion
      const moduleUrl = pathToFileURL(normalizedPath).href + `?t=${Date.now()}`;
      const config = await import(/* @vite-ignore */ moduleUrl);

      return config.default || config;
    } catch (error: any) {
      // Log error for debugging but continue searching
      if (process.env.FARM_VERBOSE) {
        console.warn(`Failed to load config from ${relativePath}:`, error.message);
      }
      continue;
    }
  }
  return undefined;
}
