import type {
  FarmConfig as BaseFarmConfig,
  FarmMigrationCommand,
  FarmMigrationsConfig,
  FarmMigrationsUserConfig,
  ResolvedFarmMigrationsConfig,
} from "./types";
import type { DocsConfig } from "@farming-labs/docs";
import type { FarmDocsResolvedConfig, FarmDocsUserConfig } from "./docs/types";
import type { FarmIntegrationsUserConfig } from "./integrations";
import type { FarmMarkdownResolvedConfig, FarmMarkdownUserConfig } from "./markdown";
import type { FarmObservabilityUserConfig } from "./observability";
import type { FarmMiddlewareConfig } from "./middleware/types";
import type { FarmPlugin } from "./plugin";
import type { FarmWorkflowsResolvedConfig, FarmWorkflowsUserConfig } from "./workflows";
import type { FarmCronResolvedConfig, FarmCronUserConfig } from "./cron";
import type { FarmEnvConfig, ResolvedFarmEnv } from "./env";
import type { UserConfig as ViteUserConfig } from "vite";
import { resolveIntegrationPlugins } from "./integrations";
import { resolveMarkdownConfig } from "./markdown";
import { resolveWorkflowsConfig } from "./workflows";
import { resolveCronConfig } from "./cron";
import { resolveEnv, setEnv } from "./env";
import {
  resolveMdxConfig,
  type FarmMdxResolvedConfig,
  type FarmMdxUserConfig,
} from "./app-markdown";
import {
  normalizeRouteRules,
  routeRulesToHeaders,
  routeRulesToRedirects,
  type FarmRouteRules,
} from "./route-rules";
import {
  resolveServerActionsConfig,
  type FarmServerActionsConfig,
  type ResolvedFarmServerActionsConfig,
} from "./server-action-security";
import {
  resolveFarmServerConfig,
  type FarmServerConfig,
  type ResolvedFarmServerConfig,
} from "./server-http";
import {
  loadFarmConfigFile,
  resolveFarmLayers,
  type FarmLayerEntry,
  type ResolvedFarmLayer,
} from "./layers";
import path from "path";
import { normalizeFarmDeploymentId } from "./deployment";
import { resolveFarmDevtoolsConfig, type ResolvedFarmDevtoolsConfig } from "./devtools-config";
import {
  resolveFarmImageConfig,
  type FarmImageConfig,
  type ResolvedFarmImageConfig,
} from "./image-config";
import { resolveFarmI18nConfig } from "./i18n/config";
import type { FarmI18nUserConfig, ResolvedFarmI18nConfig } from "./i18n/types";
import type { FarmCacheUserConfig } from "./cache";
import {
  resolveFarmAuthConfig,
  resolveFarmAuthIntegration,
  type FarmAuthUserConfig,
  type ResolvedFarmAuthConfig,
} from "./auth-config";
import { resolveFarmPerformanceConfig, type ResolvedFarmPerformanceConfig } from "./preload";
import {
  getFarmSecurityHeader,
  resolveFarmSecurityConfig,
  type FarmCspConfig,
  type FarmCspDirectives,
  type FarmCspDirectiveValue,
  type FarmCspOptions,
  type FarmSecurityConfig,
  type ResolvedFarmCspConfig,
  type ResolvedFarmSecurityConfig,
} from "./security";

const FARM_RESOLVED_CUSTOM_CONTEXT = Symbol.for("farm.resolvedCustomContext");

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
export type {
  FarmMigrationCommand,
  FarmMigrationsConfig,
  FarmMigrationsUserConfig,
  ResolvedFarmMigrationsConfig,
} from "./types";
export type { FarmWorkflowsResolvedConfig, FarmWorkflowsUserConfig } from "./workflows";
export type { FarmCronJobConfig, FarmCronResolvedConfig, FarmCronUserConfig } from "./cron";
export type {
  FarmRouteRule,
  FarmRouteRuleCors,
  FarmRouteRuleRedirect,
  FarmRouteRuleRenderMode,
  FarmRouteRules,
} from "./route-rules";
export type {
  FarmServerActionsConfig,
  ResolvedFarmServerActionsConfig,
} from "./server-action-security";
export type {
  FarmServerConfig,
  FarmServerDuration,
  FarmServerHealthConfig,
  ResolvedFarmServerConfig,
  ResolvedFarmServerHealthConfig,
} from "./server-http";
export type { FarmLayerEntry, ResolvedFarmLayer } from "./layers";
export type {
  FarmDevtoolsConfig,
  FarmDevtoolsUserConfig,
  ResolvedFarmDevtoolsConfig,
} from "./devtools-config";
export type {
  FarmPerformanceConfig,
  FarmPreloadMode,
  FarmPreloadUserConfig,
  ResolvedFarmPerformanceConfig,
  ResolvedFarmPreloadConfig,
} from "./preload";
export type {
  FarmImageConfig,
  FarmImageFormat,
  FarmImageLocalPattern,
  FarmImageProvider,
  FarmImageRemotePattern,
  ResolvedFarmImageConfig,
} from "./image-config";
export type {
  FarmI18nCookieConfig,
  FarmI18nDetectionSignal,
  FarmI18nDirection,
  FarmI18nRouting,
  FarmI18nUserConfig,
  ResolvedFarmI18nConfig,
} from "./i18n/types";
export type {
  FarmAuthConfig,
  FarmAuthDatabaseConfig,
  FarmAuthEmailAndPasswordConfig,
  FarmAuthSessionConfig,
  FarmAuthUserConfig,
  ResolvedFarmAuthConfig,
} from "./auth-config";
export type {
  FarmCspConfig,
  FarmCspDirectives,
  FarmCspDirectiveValue,
  FarmCspOptions,
  FarmSecurityConfig,
  ResolvedFarmCspConfig,
  ResolvedFarmSecurityConfig,
} from "./security";

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

/** @deprecated Use FarmImageConfig. */
export type ImageConfig = FarmImageConfig;

/** @deprecated Use FarmI18nUserConfig. */
export type I18nConfig = FarmI18nUserConfig;

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

export interface FarmUserConfig extends Omit<BaseFarmConfig, "vite" | "docs" | "env" | "layers"> {
  /** Reusable Farm directories or installed packages, applied from left to right. */
  extends?: readonly FarmLayerEntry[];
  plugins?: FarmPlugin[];
  integrations?: FarmIntegrationsUserConfig;
  /**
   * Farm-native authentication. `true` enables email/password auth with
   * server helpers from `@farm.js/auth/server` and React APIs from
   * `@farm.js/auth/client`.
   */
  auth?: FarmAuthUserConfig;
  /** Shared application data, route, ISR, and PPR cache. */
  cache?: FarmCacheUserConfig;
  migrations?: FarmMigrationsUserConfig;
  /** Map portable cron schedules to ordinary GET API routes. */
  cron?: FarmCronUserConfig | FarmCronResolvedConfig | false;
  workflows?: FarmWorkflowsUserConfig | boolean;
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

  i18n?: FarmI18nUserConfig | false;
  openapi?: OpenAPIConfig;

  middleware?: FarmMiddlewareConfig;
  routeRules?: FarmRouteRules;
  context?: BaseFarmConfig["context"];
  /** Server ingress and trusted-proxy policy. */
  server?: FarmServerConfig;
  serverActions?: FarmServerActionsConfig;
  /** Build identifier used to detect and recover from deployment version skew. */
  deploymentId?: string;

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

  env?: FarmEnvConfig<any, any>;

  typescript?: {
    tsconfigPath?: string;
    ignoreBuildErrors?: boolean;
  };

  vite?: ViteUserConfig | ((config: ViteUserConfig) => ViteUserConfig);

  [key: string]: any;
}

export interface ResolvedFarmConfig extends Required<
  Omit<
    FarmUserConfig,
    | "extends"
    | "plugins"
    | "vite"
    | "deploy"
    | "docs"
    | "md"
    | "mdx"
    | "migrations"
    | "cron"
    | "workflows"
    | "env"
    | "server"
    | "serverActions"
    | "devtools"
    | "images"
    | "i18n"
    | "auth"
    | "performance"
    | "security"
  >
> {
  /** @internal Tracks whether `context` came from user/layer config instead of the default noop. */
  [FARM_RESOLVED_CUSTOM_CONTEXT]?: boolean;
  extends: readonly FarmLayerEntry[];
  layers: ResolvedFarmLayer[];
  plugins: FarmPlugin[];
  vite: ViteUserConfig;
  deploy: ResolvedFarmDeployConfig;
  docs: FarmDocsResolvedConfig;
  md: FarmMarkdownResolvedConfig;
  mdx: FarmMdxResolvedConfig;
  migrations: ResolvedFarmMigrationsConfig;
  cron: FarmCronResolvedConfig;
  workflows: FarmWorkflowsResolvedConfig;
  env: ResolvedFarmEnv;
  server: ResolvedFarmServerConfig;
  serverActions: ResolvedFarmServerActionsConfig;
  devtools: ResolvedFarmDevtoolsConfig;
  images: ResolvedFarmImageConfig;
  i18n: ResolvedFarmI18nConfig;
  auth: ResolvedFarmAuthConfig;
  performance: ResolvedFarmPerformanceConfig;
  security: ResolvedFarmSecurityConfig;
  routeRules: FarmRouteRules;
}

export function hasCustomFarmRouteContext(config: ResolvedFarmConfig): boolean {
  return config[FARM_RESOLVED_CUSTOM_CONTEXT] === true;
}

export type FarmLayerConfig = Omit<
  FarmUserConfig,
  | "root"
  | "outDir"
  | "distDir"
  | "deploy"
  | "output"
  | "preset"
  | "publicDir"
  | "generateBuildId"
  | "deploymentId"
>;

export { defineConfig, defineFarmConfig } from "./config-entry";

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
  if (preset === "cloudflare" || preset === "cloudflare-pages" || preset === "cloudflare-module") {
    return "cloudflare";
  }
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

export function resolveMigrationsConfig(
  migrations: FarmMigrationsUserConfig | undefined,
): ResolvedFarmMigrationsConfig {
  if (!migrations) return { commands: [] };
  if (Array.isArray(migrations)) return { commands: migrations };
  return { commands: migrations.commands || [] };
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
  const root = path.resolve(rootDir || process.cwd());

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
  const root = path.resolve(rootDir || process.cwd());
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
    adapter: undefined,
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
    ...(docsOptions.adapter ? { adapter: docsOptions.adapter } : {}),
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
  const projectRoot = userConfig.root || process.cwd();
  const layerResolution = await resolveFarmLayers(userConfig, {
    root: projectRoot,
    mode,
  });
  userConfig = layerResolution.config;

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
  const routeRules = normalizeRouteRules(userConfig.routeRules);
  const routeRuleRedirects = routeRulesToRedirects(routeRules);
  const routeRuleHeaders = routeRulesToHeaders(routeRules);
  const security = resolveFarmSecurityConfig(userConfig.security);
  const securityHeader = getFarmSecurityHeader(security);

  const deploy = resolveDeployConfig(userConfig);
  const root = userConfig.root || process.cwd();
  const srcDir = userConfig.srcDir || "src";
  const docs = await resolveDocsConfig(userConfig.docs, { root, srcDir });
  const md = resolveMarkdownConfig(userConfig.md);
  const mdx = resolveMdxConfig(userConfig.mdx);
  const env = resolveEnv(userConfig.env, process.env);
  setEnv(env);
  const auth = resolveFarmAuthConfig(userConfig.auth);
  if (auth.enabled && userConfig.integrations?.auth) {
    throw new Error(
      "Choose either the top-level `auth` config or `integrations.auth`; they cannot both own the auth route.",
    );
  }
  const nativeAuthIntegration = await resolveFarmAuthIntegration(auth, {
    root,
    mode,
  });
  const integrations = nativeAuthIntegration
    ? { ...userConfig.integrations, auth: nativeAuthIntegration }
    : userConfig.integrations || {};
  const generateBuildId = userConfig.generateBuildId || (() => `build-${Date.now()}`);
  const deploymentId = normalizeFarmDeploymentId(
    userConfig.deploymentId ||
      process.env.FARM_DEPLOYMENT_ID ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.CF_PAGES_COMMIT_SHA ||
      (mode === "production" ? await generateBuildId() : "development"),
  );

  const resolved: ResolvedFarmConfig = {
    [FARM_RESOLVED_CUSTOM_CONTEXT]: typeof userConfig.context === "function",
    root,
    srcDir,
    extends: userConfig.extends || [],
    layers: layerResolution.layers,
    outDir: userConfig.outDir || "dist",
    basePath: userConfig.basePath || "/",
    preset: deploy.preset || "node-server",
    deploy,
    docs,
    md,
    mdx,
    migrations: resolveMigrationsConfig(userConfig.migrations),
    cron: resolveCronConfig(userConfig.cron),
    workflows: resolveWorkflowsConfig(userConfig.workflows),
    observability: userConfig.observability ?? false,
    devtools: resolveFarmDevtoolsConfig(userConfig.devtools, mode),
    storage: userConfig.storage || {},
    cache: userConfig.cache || {},
    auth,
    suppressLintOnLink: userConfig.suppressLintOnLink ?? false,
    experimental: {
      serverComponents: false,
      serverActions: false,
      ...userConfig.experimental,
    },
    plugins: [...resolveIntegrationPlugins(integrations), ...(userConfig.plugins || [])],
    integrations,
    trailingSlash: userConfig.trailingSlash ?? false,
    redirects: () => [...redirects, ...routeRuleRedirects],
    rewrites: () => rewrites,
    headers: () => [
      ...headers,
      ...routeRuleHeaders,
      ...(securityHeader ? [{ source: "/*", headers: [securityHeader] }] : []),
    ],
    routeRules,
    images: resolveFarmImageConfig(userConfig.images),
    performance: resolveFarmPerformanceConfig(userConfig.performance),
    publicDir: userConfig.publicDir || "public",
    i18n: resolveFarmI18nConfig(userConfig.i18n, { root, mode }),
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
    context: userConfig.context || (() => undefined),
    server: resolveFarmServerConfig(userConfig.server),
    serverActions: resolveServerActionsConfig(userConfig.serverActions),
    security,
    deploymentId,
    output: userConfig.output || "standalone",
    distDir: userConfig.distDir || ".farm",
    generateBuildId,
    compress: userConfig.compress ?? true,
    devIndicators: {
      buildActivity: true,
      buildActivityPosition: "bottom-right",
      ...userConfig.devIndicators,
    },
    serverRuntimeConfig: userConfig.serverRuntimeConfig || {},
    publicRuntimeConfig: userConfig.publicRuntimeConfig || {},
    env,
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
  loadEnvironment?: (typeof import("vite"))["loadEnv"],
): Promise<FarmUserConfig | undefined> {
  const { existsSync } = await import("fs");
  const loadEnv = loadEnvironment || (await import("vite")).loadEnv;

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

      const loadedConfig = await loadFarmConfigFile<FarmUserConfig>(normalizedPath, { root });
      return loadedConfig.root === undefined ? { ...loadedConfig, root } : loadedConfig;
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load config from ${relativePath}: ${message}`);
    }
  }
  return undefined;
}
