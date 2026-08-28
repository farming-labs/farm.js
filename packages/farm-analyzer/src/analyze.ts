import { constants as zlibConstants, brotliCompressSync, gzipSync } from "node:zlib";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AnalyzerMetric, ResolvedAnalyzerLimits } from "./config.js";

export interface AnalyzerSizes {
  raw: number;
  gzip: number;
  brotli: number;
}

export type AnalyzerAssetKind = "script" | "style" | "html" | "image" | "font" | "data" | "other";

export interface AnalyzerAsset {
  path: string;
  kind: AnalyzerAssetKind;
  sizes: AnalyzerSizes;
  usedByPages?: number;
}

export interface AnalyzerPage {
  route: string;
  file: string;
  assets: string[];
  sizes: AnalyzerSizes;
}

export interface AnalyzerBuildReport {
  schemaVersion: 1;
  generatedAt: string;
  preset: string;
  metric: AnalyzerMetric;
  outputDirectory: string;
  publicDirectory: string | null;
  summary: {
    pages: number;
    client: AnalyzerSizes;
    server: AnalyzerSizes;
    public: AnalyzerSizes;
    largestPage: { route: string; sizes: AnalyzerSizes } | null;
  };
  pages: AnalyzerPage[];
  clientAssets: AnalyzerAsset[];
  serverAssets: AnalyzerAsset[];
  publicAssets: AnalyzerAsset[];
  notes: string[];
}

export type AnalyzerLimitKind = "page" | "asset" | "client" | "server";

export interface AnalyzerLimitViolation {
  kind: AnalyzerLimitKind;
  name: string;
  actual: number;
  limit: number;
  metric: AnalyzerMetric;
}

export interface AnalyzeBuildOptions {
  root: string;
  distDir: string;
  outputDir: string;
  preset: string;
  metric: AnalyzerMetric;
}

interface ReadAsset extends AnalyzerAsset {
  contents?: Buffer;
}

const ZERO_SIZES: AnalyzerSizes = { raw: 0, gzip: 0, brotli: 0 };
const CLIENT_KINDS = new Set<AnalyzerAssetKind>(["script", "style"]);

export async function analyzeBuild(options: AnalyzeBuildOptions): Promise<AnalyzerBuildReport> {
  const publicDirectory = await firstDirectory([
    path.join(options.outputDir, "public"),
    path.join(options.outputDir, "static"),
    path.join(options.root, options.distDir, "client"),
  ]);
  const serverDirectory = await firstDirectory([
    path.join(options.outputDir, "server"),
    path.join(options.outputDir, "functions", "__nitro.func"),
    path.join(options.root, options.distDir, "server"),
  ]);

  const publicFiles = publicDirectory
    ? await readAssets(publicDirectory, {
        retainSourceKinds: new Set(["html", "script", "style"]),
      })
    : [];
  const serverFiles = serverDirectory
    ? await readAssets(serverDirectory, {
        includeKinds: new Set(["script"]),
        retainSourceKinds: new Set(),
      })
    : [];
  const pages = buildPages(publicFiles);
  const pageUsage = countPageUsage(pages);
  const publicAssets = publicFiles
    .filter((asset) => asset.kind !== "html")
    .map(({ contents: _contents, ...asset }) => ({
      ...asset,
      usedByPages: CLIENT_KINDS.has(asset.kind) ? (pageUsage.get(asset.path) ?? 0) : undefined,
    }));
  const clientAssets = publicAssets.filter((asset) => CLIENT_KINDS.has(asset.kind));
  const serverAssets = serverFiles.map(({ contents: _contents, ...asset }) => asset);

  sortAssets(clientAssets, options.metric);
  sortAssets(serverAssets, options.metric);
  sortAssets(publicAssets, options.metric);
  pages.sort((left, right) => right.sizes[options.metric] - left.sizes[options.metric]);

  const notes: string[] = [];
  if (!publicDirectory) {
    notes.push(
      "No final public directory was found, so client assets and emitted pages are empty.",
    );
  }
  if (!serverDirectory) {
    notes.push("No final server directory was found, so server totals are empty.");
  }
  notes.push(
    "Page totals cover emitted HTML and its statically referenced JavaScript and CSS. Dynamic SSR pages are represented by the client and server totals instead of an estimated route size.",
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    preset: options.preset,
    metric: options.metric,
    outputDirectory: relativePath(options.root, options.outputDir),
    publicDirectory: publicDirectory ? relativePath(options.root, publicDirectory) : null,
    summary: {
      pages: pages.length,
      client: sumSizes(clientAssets),
      server: sumSizes(serverAssets),
      public: sumSizes(publicAssets),
      largestPage: pages[0] ? { route: pages[0].route, sizes: pages[0].sizes } : null,
    },
    pages,
    clientAssets,
    serverAssets,
    publicAssets,
    notes,
  };
}

export function evaluateLimits(
  report: AnalyzerBuildReport,
  limits: ResolvedAnalyzerLimits,
): AnalyzerLimitViolation[] {
  const metric = report.metric;
  const violations: AnalyzerLimitViolation[] = [];

  if (limits.page !== undefined) {
    for (const page of report.pages) {
      addViolation(violations, "page", page.route, page.sizes[metric], limits.page, metric);
    }
  }
  if (limits.asset !== undefined) {
    for (const asset of report.clientAssets) {
      addViolation(violations, "asset", asset.path, asset.sizes[metric], limits.asset, metric);
    }
  }
  if (limits.client !== undefined) {
    addViolation(
      violations,
      "client",
      "all client JavaScript and CSS",
      report.summary.client[metric],
      limits.client,
      metric,
    );
  }
  if (limits.server !== undefined) {
    addViolation(
      violations,
      "server",
      "all server JavaScript",
      report.summary.server[metric],
      limits.server,
      metric,
    );
  }

  return violations.sort((left, right) => right.actual - right.limit - (left.actual - left.limit));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${formatNumber(bytes / 1_024)} KB`;
  if (bytes < 1_073_741_824) return `${formatNumber(bytes / 1_048_576)} MB`;
  return `${formatNumber(bytes / 1_073_741_824)} GB`;
}

function buildPages(files: ReadAsset[]): AnalyzerPage[] {
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const pages: AnalyzerPage[] = [];

  for (const html of files.filter((file) => file.kind === "html")) {
    const directAssets = extractHtmlReferences(
      html.contents?.toString("utf8") ?? "",
      html.path,
      fileByPath,
    );
    const assets = collectInitialAssets(directAssets, fileByPath);
    pages.push({
      route: routeFromHtml(html.path),
      file: html.path,
      assets: [...assets].sort(),
      sizes: sumSizes([...assets].map((assetPath) => fileByPath.get(assetPath))),
    });
  }

  return pages;
}

function extractHtmlReferences(
  html: string,
  htmlPath: string,
  files: Map<string, ReadAsset>,
): Set<string> {
  const references = new Set<string>();
  for (const match of html.matchAll(/<(script|link)\b([^>]*)>/gi)) {
    const tag = match[1].toLowerCase();
    const attributes = parseAttributes(match[2]);
    const value = tag === "script" ? attributes.src : attributes.href;
    if (!value) continue;

    if (tag === "link") {
      const rel = (attributes.rel ?? "").toLowerCase().split(/\s+/);
      if (
        !rel.some(
          (value) => value === "stylesheet" || value === "modulepreload" || value === "preload",
        )
      ) {
        continue;
      }
    }

    const resolved = resolveAssetReference(value, htmlPath, files);
    if (resolved && CLIENT_KINDS.has(files.get(resolved)?.kind ?? "other")) {
      references.add(resolved);
    }
  }
  return references;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function collectInitialAssets(entries: Set<string>, files: Map<string, ReadAsset>): Set<string> {
  const collected = new Set<string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || collected.has(current)) continue;
    const asset = files.get(current);
    if (!asset || !CLIENT_KINDS.has(asset.kind)) continue;
    collected.add(current);

    const source = asset.contents?.toString("utf8") ?? "";
    const references =
      asset.kind === "script" ? extractStaticImports(source) : extractCssImports(source);
    for (const reference of references) {
      const resolved = resolveAssetReference(reference, current, files);
      if (resolved && !collected.has(resolved)) pending.push(resolved);
    }
  }

  return collected;
}

export function extractStaticImports(source: string): string[] {
  const imports = new Set<string>();
  const importPattern = /\bimport\s*(?:["']([^"']+)["']|[^"'();]+?\bfrom\s*["']([^"']+)["'])/g;
  const exportPattern = /\bexport\s*[^"';]+?\bfrom\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(importPattern)) imports.add(match[1] ?? match[2]);
  for (const match of source.matchAll(exportPattern)) imports.add(match[1]);
  return [...imports];
}

function extractCssImports(source: string): string[] {
  return [...source.matchAll(/@import\s+(?:url\(\s*)?["']([^"']+)["']/g)].map((match) => match[1]);
}

function resolveAssetReference(
  reference: string,
  importerPath: string,
  files: Map<string, ReadAsset>,
): string | undefined {
  if (/^(?:data:|blob:|https?:|\/\/)/i.test(reference)) return undefined;
  const clean = reference.split(/[?#]/, 1)[0];
  if (!clean) return undefined;

  const candidate = clean.startsWith("/")
    ? normalizeFilePath(clean.slice(1))
    : normalizeFilePath(path.posix.join(path.posix.dirname(importerPath), clean));
  if (files.has(candidate)) return candidate;

  // A basePath can be present in the public URL without being a physical
  // directory in the output. Match the longest emitted suffix in that case.
  const suffixMatches = [...files.keys()]
    .filter((filePath) => candidate.endsWith(`/${filePath}`))
    .sort((left, right) => right.length - left.length);
  return suffixMatches[0];
}

async function readAssets(
  directory: string,
  options: {
    includeKinds?: Set<AnalyzerAssetKind>;
    retainSourceKinds: Set<AnalyzerAssetKind>;
  },
): Promise<ReadAsset[]> {
  const files = await walkFiles(directory);
  const included = files
    .filter((file) => !file.endsWith(".map"))
    .map((file) => ({ file, kind: classifyAsset(file) }))
    .filter(({ kind }) => !options.includeKinds || options.includeKinds.has(kind));
  const assets: ReadAsset[] = [];

  // Keep memory bounded for image-heavy public directories while still
  // analyzing normal application builds in parallel.
  for (let index = 0; index < included.length; index += 16) {
    const batch = included.slice(index, index + 16);
    assets.push(
      ...(await Promise.all(
        batch.map(async ({ file, kind }) => {
          const contents = await readFile(path.join(directory, file));
          return {
            path: normalizeFilePath(file),
            kind,
            sizes: measure(contents),
            contents: options.retainSourceKinds.has(kind) ? contents : undefined,
          };
        }),
      )),
    );
  }
  return assets;
}

async function walkFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(prefix, entry.name);
      if (entry.isDirectory()) return walkFiles(directory, entryPath);
      return entry.isFile() ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function measure(contents: Buffer): AnalyzerSizes {
  return {
    raw: contents.byteLength,
    gzip: gzipSync(contents).byteLength,
    brotli: brotliCompressSync(contents, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
    }).byteLength,
  };
}

function classifyAsset(file: string): AnalyzerAssetKind {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return "script";
  if (extension === ".css") return "style";
  if (extension === ".html") return "html";
  if ([".avif", ".gif", ".ico", ".jpeg", ".jpg", ".png", ".svg", ".webp"].includes(extension))
    return "image";
  if ([".eot", ".otf", ".ttf", ".woff", ".woff2"].includes(extension)) return "font";
  if ([".json", ".webmanifest", ".wasm", ".xml"].includes(extension)) return "data";
  return "other";
}

function routeFromHtml(file: string): string {
  const normalized = normalizeFilePath(file);
  if (normalized === "index.html") return "/";
  if (normalized.endsWith("/index.html")) return `/${normalized.slice(0, -"/index.html".length)}`;
  return `/${normalized.slice(0, -".html".length)}`;
}

function countPageUsage(pages: AnalyzerPage[]): Map<string, number> {
  const usage = new Map<string, number>();
  for (const page of pages) {
    for (const asset of page.assets) usage.set(asset, (usage.get(asset) ?? 0) + 1);
  }
  return usage;
}

function sumSizes(assets: Array<Pick<AnalyzerAsset, "sizes"> | undefined>): AnalyzerSizes {
  return assets.reduce<AnalyzerSizes>(
    (total, asset) => ({
      raw: total.raw + (asset?.sizes.raw ?? 0),
      gzip: total.gzip + (asset?.sizes.gzip ?? 0),
      brotli: total.brotli + (asset?.sizes.brotli ?? 0),
    }),
    { ...ZERO_SIZES },
  );
}

function sortAssets(assets: AnalyzerAsset[], metric: AnalyzerMetric): void {
  assets.sort((left, right) => right.sizes[metric] - left.sizes[metric]);
}

function addViolation(
  violations: AnalyzerLimitViolation[],
  kind: AnalyzerLimitKind,
  name: string,
  actual: number,
  limit: number,
  metric: AnalyzerMetric,
): void {
  if (actual > limit) violations.push({ kind, name, actual, limit, metric });
}

async function firstDirectory(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Try the next Farm output layout.
    }
  }
  return undefined;
}

function normalizeFilePath(file: string): string {
  return file.split(path.sep).join("/").replace(/^\.\//, "");
}

function relativePath(root: string, target: string): string {
  const relative = normalizeFilePath(path.relative(root, target));
  return relative || ".";
}

function formatNumber(value: number): string {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
}
