import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { partytownSnippet, type PartytownConfig } from "@qwik.dev/partytown/integration";
import { copyLibFiles, libDirPath } from "@qwik.dev/partytown/utils";
import type { ResolvedPartytownOptions } from "./config.js";

export const PARTYTOWN_DIRECTORY = "~partytown";
export const PARTYTOWN_BOOTSTRAP = "farm-partytown.js";

export interface PartytownBuildInput {
  outputDir: string;
  publicDir?: string;
  preset: string;
  basePath: string;
  options: ResolvedPartytownOptions;
}

export interface PartytownBuildResult {
  assetsDir: string;
  bootstrapPath: string;
  bootstrapUrl: string;
}

export async function writePartytownBuildArtifacts(
  input: PartytownBuildInput,
): Promise<PartytownBuildResult> {
  const publicDir = input.publicDir ?? resolvePartytownPublicDir(input.outputDir, input.preset);
  const basePath = normalizeBasePath(input.basePath);
  const relativeAssetsDir = path.posix.join(basePath.slice(1), PARTYTOWN_DIRECTORY);
  const assetsDir = path.join(publicDir, ...relativeAssetsDir.split("/"));
  const debug = input.options.debug ?? false;

  await copyLibFiles(assetsDir, { debugDir: debug });
  const bootstrapPath = path.join(assetsDir, PARTYTOWN_BOOTSTRAP);
  await writeFile(bootstrapPath, createPartytownBootstrap(input.options, basePath, false), "utf8");

  return {
    assetsDir,
    bootstrapPath,
    bootstrapUrl: partytownAssetUrl(PARTYTOWN_BOOTSTRAP, basePath),
  };
}

export function createPartytownBootstrap(
  options: ResolvedPartytownOptions,
  basePath: string,
  isDev: boolean,
): string {
  const config: PartytownConfig = {
    lib: partytownAssetUrl("", basePath),
    debug: options.debug ?? isDev,
  };
  const forward: NonNullable<PartytownConfig["forward"]> = options.forward.map(
    ({ path: forwardPath, preserveBehavior }) =>
      preserveBehavior
        ? ([forwardPath, { preserveBehavior: true }] as [string, { preserveBehavior: true }])
        : forwardPath,
  );
  if (forward.length > 0) config.forward = forward;
  if (options.fallbackTimeout !== undefined) config.fallbackTimeout = options.fallbackTimeout;
  if (options.strictProxyHas !== undefined) config.strictProxyHas = options.strictProxyHas;
  return `${partytownSnippet(config)}\n`;
}

export function injectPartytownBootstrap(html: string, bootstrapUrl: string): string {
  if (hasPartytownBootstrap(html)) return html;
  const closingHead = html.search(/<\/head\s*>/i);
  if (closingHead < 0) return html;
  const tag = `<script src="${escapeHtmlAttribute(bootstrapUrl)}" data-farm-partytown></script>`;
  return `${html.slice(0, closingHead)}${tag}${html.slice(closingHead)}`;
}

function hasPartytownBootstrap(html: string): boolean {
  const scriptTags = html.matchAll(/<script\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi);
  for (const tag of scriptTags) {
    const attributes = tag[0].slice("<script".length, -1);
    const parsed = attributes.matchAll(/([^\s"'<>=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>]+))?/g);
    for (const attribute of parsed) {
      if (attribute[1]?.toLowerCase() === "data-farm-partytown") return true;
    }
  }
  return false;
}

export async function readPartytownDevAsset(
  pathname: string,
  basePath: string,
  options: ResolvedPartytownOptions,
): Promise<{ body: Buffer | string; contentType: string } | undefined> {
  const prefix = partytownAssetUrl("", basePath);
  if (!pathname.startsWith(prefix)) return undefined;

  let relativePath: string;
  try {
    relativePath = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return undefined;
  }
  if (!relativePath || relativePath.includes("\\")) return undefined;
  if (relativePath === PARTYTOWN_BOOTSTRAP) {
    return {
      body: createPartytownBootstrap(options, basePath, true),
      contentType: "text/javascript; charset=utf-8",
    };
  }

  const libraryDir = path.resolve(libDirPath());
  const assetPath = path.resolve(libraryDir, relativePath);
  if (!assetPath.startsWith(`${libraryDir}${path.sep}`)) return undefined;
  try {
    return {
      body: await readFile(assetPath),
      contentType: contentTypeFor(relativePath),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "/";
  if (!value.startsWith("/") || /[<>"'?#\\]/.test(value)) {
    throw new TypeError("partytown requires basePath to be a safe absolute URL path");
  }
  const segments = value.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new TypeError("partytown requires basePath without dot path segments");
  }
  return `/${segments.join("/")}`;
}

export function partytownAssetUrl(file: string, basePath: string): string {
  const base = normalizeBasePath(basePath);
  const prefix = base === "/" ? "" : base;
  return `${prefix}/${PARTYTOWN_DIRECTORY}/${file}`;
}

export function resolvePartytownPublicDir(outputDir: string, preset: string): string {
  return path.join(outputDir, preset.startsWith("vercel") ? "static" : "public");
}

function contentTypeFor(file: string): string {
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
