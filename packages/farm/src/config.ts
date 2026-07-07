import type { FarmConfig as BaseFarmConfig } from "./types";
import type { DocsConfig } from "@farming-labs/docs";
import type { FarmDocsResolvedConfig, FarmDocsUserConfig } from "./docs/types";
import type { FarmIntegrationsUserConfig } from "./integrations";
import type { FarmMarkdownResolvedConfig, FarmMarkdownUserConfig } from "./markdown";
import type { FarmObservabilityUserConfig } from "./observability";
import type { FarmMiddlewareConfig } from "./middleware/types";
import type { FarmPlugin } from "./plugin";
import type { UserConfig as ViteUserConfig } from "vite";
import { resolveIntegrationPlugins } from "./integrations";
import { resolveMarkdownConfig } from "./markdown";
import {
  resolveMdxConfig,
  type FarmMdxResolvedConfig,
  type FarmMdxUserConfig,
} from "./app-markdown";
import path from "path";

export type {
  FarmDocsConfigInput,
  FarmDocsNavigationConfig,
  FarmDocsResolvedConfig,
  FarmDocsSidebarItem,
  FarmDocsUserConfig,
} from "./docs/types";
export type {
  FarmMarkdownResolvedConfig,
  FarmMarkdownRouteInput,
  FarmMarkdownUserConfig,
} from "./markdown";
export type { FarmMdxComponents, FarmMdxResolvedConfig, FarmMdxUserConfig } from "./app-markdown";

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

export type MiddlewareConfig = FarmMiddlewareConfig;

export interface NotFoundConfig {
  /** Path to a custom 404 page component (e.g., "./src/app/not-found.tsx") */
  component?: string;
}

export type FarmDeployTarget = "vercel" | "cloudflare" | "netlify" | "node" | string;

export interface FarmDeployConfig {
  /**
   * Deployment platform. When present, Farm picks the matching Nitro preset and
   * output directory unless explicitly overridden.
   */
  target?: FarmDeployTarget;
  /** Nitro preset override. Usually inferred from target. */
  preset?: BaseFarmConfig["preset"];
  /** Deployable output directory, relative to project root unless absolute. */
  outputDir?: string;
  /** Alias for outputDir for terser config. */
  output?: string;
  /** Cloudflare Pages project name used by `farm deploy --cloudflare`. */
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
}

export interface ResolvedFarmDeployConfig extends Omit<FarmDeployConfig, "output"> {
  target?: FarmDeployTarget;
  preset: BaseFarmConfig["preset"];
  outputDir: string;
}

export interface FarmUserConfig extends Omit<BaseFarmConfig, "vite" | "docs"> {
  plugins?: FarmPlugin[];
  integrations?: FarmIntegrationsUserConfig;
  preset?: BaseFarmConfig["preset"];
  deploy?: FarmDeployConfig;
  docs?: FarmDocsUserConfig;
  md?: FarmMarkdownUserConfig | boolean;
  mdx?: FarmMdxUserConfig;
  observability?: FarmObservabilityUserConfig;

  trailingSlash?: boolean;
  redirects?: () => Promise<RedirectConfig[]> | RedirectConfig[];
  rewrites?: () => Promise<RewriteConfig[]> | RewriteConfig[];
  headers?: () => Promise<HeaderConfig[]> | HeaderConfig[];

  images?: ImageConfig;
  publicDir?: string;

  i18n?: I18nConfig;
  openapi?: OpenAPIConfig;

  middleware?: FarmMiddlewareConfig;

  notFound?: NotFoundConfig;

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

export interface ResolvedFarmConfig extends Required<
  Omit<FarmUserConfig, "plugins" | "vite" | "deploy" | "docs" | "md" | "mdx">
> {
  plugins: FarmPlugin[];
  vite: ViteUserConfig;
  deploy: ResolvedFarmDeployConfig;
  docs: FarmDocsResolvedConfig;
  md: FarmMarkdownResolvedConfig;
  mdx: FarmMdxResolvedConfig;
}

export function defineFarmConfig(config: FarmUserConfig): FarmUserConfig {
  return config;
}

export function normalizeDeployTarget(target?: FarmDeployTarget): FarmDeployTarget | undefined {
  if (!target) return undefined;
  if (target === "cloudflare-pages" || target === "cloudflare_pages") return "cloudflare";
  if (target === "node-server" || target === "nitro") return "node";
  return target;
}

export function getPresetForDeployTarget(
  target?: FarmDeployTarget,
): BaseFarmConfig["preset"] | undefined {
  switch (normalizeDeployTarget(target)) {
    case "vercel":
      return "vercel";
    case "cloudflare":
      return "cloudflare-pages";
    case "netlify":
      return "netlify";
    case "node":
      return "node-server";
    default:
      return undefined;
  }
}

export function getDeployTargetForPreset(preset?: string): FarmDeployTarget | undefined {
  if (!preset) return undefined;
  if (preset === "vercel" || preset === "vercel-edge") return "vercel";
  if (preset === "cloudflare" || preset === "cloudflare-pages") return "cloudflare";
  if (preset === "netlify" || preset === "netlify-edge") return "netlify";
  if (preset === "node-server") return "node";
  return undefined;
}

export function getDefaultDeployOutputDir(
  target: FarmDeployTarget | undefined,
  preset: string | undefined,
  distDir: string,
): string {
  const normalizedTarget = normalizeDeployTarget(target) || getDeployTargetForPreset(preset);
  if (normalizedTarget === "vercel") return ".vercel/output";
  return `${distDir}/.output`;
}

export function resolveDeployOutputPath(root: string, outputDir: string): string {
  return path.isAbsolute(outputDir) ? outputDir : path.join(root, outputDir);
}

export function resolveDeployConfig(
  config: Pick<FarmUserConfig, "deploy" | "preset" | "distDir">,
  overrides: {
    target?: FarmDeployTarget;
    preset?: BaseFarmConfig["preset"];
    outputDir?: string;
  } = {},
): ResolvedFarmDeployConfig {
  const deploy = config.deploy || {};
  const distDir = config.distDir || ".farm";
  const target = normalizeDeployTarget(overrides.target || deploy.target);
  const preset =
    overrides.preset ||
    deploy.preset ||
    config.preset ||
    getPresetForDeployTarget(target) ||
    "node-server";
  const resolvedTarget = target || getDeployTargetForPreset(preset);
  const platformOutput =
    resolvedTarget === "vercel"
      ? deploy.vercel?.outputDirectory
      : resolvedTarget === "cloudflare"
        ? deploy.cloudflare?.outputDir
        : resolvedTarget === "netlify"
          ? deploy.netlify?.outputDir
          : undefined;
  const outputDir =
    overrides.outputDir ||
    deploy.outputDir ||
    deploy.output ||
    platformOutput ||
    getDefaultDeployOutputDir(resolvedTarget, preset, distDir);

  return {
    ...deploy,
    target: resolvedTarget,
    preset,
    outputDir,
  };
}

export const DOCS_CONFIG_FILENAMES = [
  "docs.config.ts",
  "docs.config.tsx",
  "docs.config.mts",
  "docs.config.cts",
  "docs.config.js",
  "docs.config.jsx",
  "docs.config.mjs",
  "docs.config.cjs",
  "docs.json",
];

function normalizeDocsRoute(value: string | undefined, fallback = "/docs"): string {
  const raw = (value || fallback).trim();
  if (!raw || raw === "/") return "/";
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/?/, "/")
    .replace(/\/+$/, "");
  return normalized || "/";
}

function docsRouteToEntry(route: string): string {
  const entry = route.replace(/^\/+/, "").replace(/\/+$/, "");
  return entry || "docs";
}

function normalizeDocsContentDir(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "");
  return normalized || undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneSerializable(value: unknown, seen = new WeakSet<object>()): any {
  if (value === null) return null;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "number" || valueType === "boolean") {
    return value;
  }
  if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneSerializable(item, seen)).filter((item) => item !== undefined);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (isRecord(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);

    const output: Record<string, any> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const clonedValue = cloneSerializable(nestedValue, seen);
      if (clonedValue !== undefined) {
        output[key] = clonedValue;
      }
    }
    return output;
  }

  return undefined;
}

function sanitizeDocsConfig(config: Partial<DocsConfig>): Partial<DocsConfig> {
  return cloneSerializable(config) || {};
}

export async function findDocsConfigPath(
  rootDir: string,
  configPath?: string,
): Promise<string | undefined> {
  const { existsSync } = await import("fs");
  const root = rootDir || process.cwd();

  if (configPath) {
    const resolvedPath = path.isAbsolute(configPath) ? configPath : path.join(root, configPath);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Could not find docs config at ${configPath}.`);
    }
    return path.resolve(resolvedPath);
  }

  for (const filename of DOCS_CONFIG_FILENAMES) {
    const resolvedPath = path.join(root, filename);
    if (existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return undefined;
}

export async function loadDocsConfig(
  rootDir: string,
  configPath?: string,
): Promise<{ config: Partial<DocsConfig>; configPath: string } | undefined> {
  const fs = await import("fs/promises");
  const { pathToFileURL } = await import("url");
  const root = rootDir || process.cwd();
  const resolvedPath = await findDocsConfigPath(root, configPath);

  if (!resolvedPath) return undefined;

  try {
    if (resolvedPath.endsWith(".json")) {
      const content = await fs.readFile(resolvedPath, "utf8");
      return { config: JSON.parse(content), configPath: resolvedPath };
    }

    const { build } = await import("esbuild");
    const configCacheDir = path.join(root, ".farm", ".config-loader");
    await fs.mkdir(configCacheDir, { recursive: true });
    const modulePath = path.join(
      configCacheDir,
      `docs-config-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
    );

    await build({
      absWorkingDir: root,
      entryPoints: [resolvedPath],
      outfile: modulePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: `node${process.versions.node.split(".")[0]}`,
      packages: "external",
      jsx: "automatic",
      logLevel: "silent",
      sourcemap: "inline",
    });

    const moduleUrl = pathToFileURL(modulePath).href + `?t=${Date.now()}`;
    let importedConfig: any;

    try {
      importedConfig = await import(/* @vite-ignore */ moduleUrl);
    } finally {
      await fs.unlink(modulePath).catch(() => undefined);
    }

    return {
      config: importedConfig.default || importedConfig,
      configPath: resolvedPath,
    };
  } catch (error: any) {
    const relativePath = path.relative(root, resolvedPath) || resolvedPath;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load docs config from ${relativePath}: ${message}`);
  }
}

export async function resolveDocsConfig(
  userDocs: FarmDocsUserConfig | undefined,
  options: {
    root?: string;
    srcDir?: string;
  } = {},
): Promise<FarmDocsResolvedConfig> {
  const root = options.root || process.cwd();

  if (userDocs === false) {
    return {
      enabled: false,
      entry: "/docs",
      config: { entry: "docs", docsPath: "/docs" },
    };
  }

  const docsOptions = isRecord(userDocs) ? userDocs : {};
  if (docsOptions.enabled === false) {
    return {
      enabled: false,
      entry: "/docs",
      config: { entry: "docs", docsPath: "/docs" },
    };
  }

  const loadedConfig = await loadDocsConfig(root, docsOptions.configPath);
  const hasExplicitDocsConfig = userDocs === true || isRecord(userDocs);

  if (!hasExplicitDocsConfig && !loadedConfig) {
    return {
      enabled: false,
      entry: "/docs",
      config: { entry: "docs", docsPath: "/docs" },
    };
  }

  const inlineDocsConfig = sanitizeDocsConfig(docsOptions.config || {});
  const directDocsConfig = sanitizeDocsConfig({
    ...docsOptions,
    enabled: undefined,
    config: undefined,
    configPath: undefined,
  } as Partial<DocsConfig>);
  const loadedDocsConfig = sanitizeDocsConfig(loadedConfig?.config || {});
  const mergedDocsConfig: Partial<DocsConfig> = {
    ...loadedDocsConfig,
    ...inlineDocsConfig,
    ...directDocsConfig,
  };

  const explicitRoute = typeof docsOptions.entry === "string" ? docsOptions.entry : undefined;
  const configuredDocsPath =
    typeof mergedDocsConfig.docsPath === "string" ? mergedDocsConfig.docsPath : undefined;
  const configuredEntry =
    typeof mergedDocsConfig.entry === "string" ? mergedDocsConfig.entry : undefined;
  const entryRoute = normalizeDocsRoute(
    configuredDocsPath || explicitRoute || (configuredEntry ? `/${configuredEntry}` : undefined),
  );
  const docsEntry =
    explicitRoute && explicitRoute.startsWith("/")
      ? docsRouteToEntry(explicitRoute)
      : docsRouteToEntry(configuredEntry || entryRoute);
  const contentDir = normalizeDocsContentDir(docsOptions.contentDir || mergedDocsConfig.contentDir);

  return {
    enabled: true,
    entry: entryRoute,
    contentDir,
    configPath: loadedConfig?.configPath,
    config: {
      ...mergedDocsConfig,
      entry: docsEntry,
      docsPath: entryRoute,
      ...(contentDir ? { contentDir } : {}),
    },
  };
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

  const deploy = resolveDeployConfig(userConfig);
  const root = userConfig.root || process.cwd();
  const srcDir = userConfig.srcDir || "src";
  const docs = await resolveDocsConfig(userConfig.docs, { root, srcDir });
  const md = resolveMarkdownConfig(userConfig.md);
  const mdx = resolveMdxConfig(userConfig.mdx);

  const resolved: ResolvedFarmConfig = {
    root,
    srcDir,
    outDir: userConfig.outDir || "dist",
    basePath: userConfig.basePath || "/",
    preset: deploy.preset || "node-server",
    deploy,
    docs,
    md,
    mdx,
    observability: userConfig.observability ?? false,
    storage: userConfig.storage || {},
    suppressLintOnLink: userConfig.suppressLintOnLink ?? false,
    experimental: {
      serverComponents: false,
      serverActions: false,
      ...userConfig.experimental,
    },
    plugins: [...resolveIntegrationPlugins(userConfig.integrations), ...(userConfig.plugins || [])],
    integrations: userConfig.integrations || {},
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
    notFound: userConfig.notFound || {},
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
  mode = process.env.NODE_ENV === "production" ? "production" : "development",
): Promise<FarmUserConfig | undefined> {
  const path = await import("path");
  const fs = await import("fs/promises");
  const { pathToFileURL } = await import("url");
  const { existsSync } = await import("fs");
  const { build } = await import("esbuild");
  const { loadEnv } = await import("vite");

  const root = rootDir || process.cwd();
  const loadedEnv = loadEnv(mode, root, "");
  for (const [key, value] of Object.entries(loadedEnv)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  const searchPaths = [
    configPath,
    "farm.config.ts",
    "farm.config.mts",
    "farm.config.js",
    "farm.config.mjs",
    "config.ts",
    "config.mts",
    "config.js",
    "config.mjs",
  ].filter(Boolean) as string[];

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

      const configCacheDir = path.join(root, ".farm", ".config-loader");
      await fs.mkdir(configCacheDir, { recursive: true });
      const modulePath = path.join(
        configCacheDir,
        `farm-config-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
      );
      await build({
        absWorkingDir: root,
        entryPoints: [normalizedPath],
        outfile: modulePath,
        bundle: true,
        format: "esm",
        platform: "node",
        target: `node${process.versions.node.split(".")[0]}`,
        packages: "external",
        jsx: "automatic",
        logLevel: "silent",
        sourcemap: "inline",
      });

      const moduleUrl = pathToFileURL(modulePath).href + `?t=${Date.now()}`;
      let config: any;

      try {
        config = await import(/* @vite-ignore */ moduleUrl);
      } finally {
        await fs.unlink(modulePath).catch(() => undefined);
      }

      return config.default || config;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config from ${relativePath}: ${message}`);
    }
  }
  return undefined;
}
