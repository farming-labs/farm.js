import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isFarmIslandStrategy, type FarmIslandStrategy } from "../island";

function readIfExists(filePath: string): string | null {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function resolveModuleSourcePath(modulePath: string, root?: string): string | null {
  const candidates = new Set<string>();
  const withoutQuery = modulePath.split("?")[0];

  if (modulePath) {
    candidates.add(modulePath);
    candidates.add(withoutQuery);

    if (modulePath.startsWith("file://")) {
      try {
        candidates.add(fileURLToPath(modulePath));
      } catch {
        // ignore invalid file urls
      }
    }

    if (modulePath.startsWith("/@fs/")) {
      candidates.add(modulePath.slice(4));
    }
  }

  if (root && modulePath) {
    const normalized = withoutQuery.replace(/^\/+/, "");
    candidates.add(path.join(root, normalized));
    candidates.add(path.resolve(root, normalized));
  }

  if (withoutQuery?.startsWith("/src/")) {
    const normalized = withoutQuery.replace(/^\/+/, "");
    candidates.add(path.join(process.cwd(), normalized));
    candidates.add(path.resolve(process.cwd(), normalized));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export interface ClientModuleMetadata {
  isClientComponent: boolean;
  shouldHydrate: boolean;
  islandStrategy: FarmIslandStrategy | null;
}

interface ParsedClientModuleMetadata {
  isClientComponent: boolean;
  hasHydrateExport: boolean;
  islandStrategy: FarmIslandStrategy | null;
}

const RESOLVABLE_SOURCE_EXTENSIONS = [
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".mts",
  ".mjs",
  ".cts",
  ".cjs",
] as const;

export function hasUseClientDirective(content: string | null): boolean {
  if (!content) {
    return false;
  }
  const normalized = content.trimStart();
  return normalized.startsWith("'use client'") || normalized.startsWith('"use client"');
}

export function hasHydrateExport(content: string | null): boolean {
  if (!content) {
    return false;
  }
  return (
    /\bexport\s+const\s+hydrate\s*=\s*true\b/.test(content) ||
    /\bexport\s*\{\s*hydrate\s*\}\b/.test(content)
  );
}

export function getIslandStrategyExport(content: string | null): FarmIslandStrategy | null {
  if (!content) return null;

  const declaration = content.match(/\bexport\s+const\s+island(?:\s*:[^=;]+)?\s*=\s*([^;\r\n]+)/);
  if (!declaration) return null;

  const literal = declaration[1].trim().match(/^(["'])([^"']+)\1$/);
  if (!literal || !isFarmIslandStrategy(literal[2])) {
    throw new Error(
      'Farm island configuration must be a static "load", "interaction", "visible", or "idle" string literal.',
    );
  }

  return literal[2];
}

export function stripUseClientDirective(content: string): string {
  return content.replace(/^\s*(["'])use client\1\s*;?\s*/, "");
}

function parseClientModuleMetadata(content: string | null): ParsedClientModuleMetadata {
  if (!content) {
    return {
      isClientComponent: false,
      hasHydrateExport: false,
      islandStrategy: null,
    };
  }

  return {
    isClientComponent: hasUseClientDirective(content),
    hasHydrateExport: hasHydrateExport(content),
    islandStrategy: getIslandStrategyExport(content),
  };
}

export function getClientModuleMetadata(modulePath: string, root?: string): ClientModuleMetadata {
  const resolvedPath = resolveModuleSourcePath(modulePath, root);
  return inspectClientModuleMetadata(resolvedPath, root, new Set());
}

export function isClientComponentModule(modulePath: string, root?: string): boolean {
  return getClientModuleMetadata(modulePath, root).isClientComponent;
}

export function shouldHydrateModule(modulePath: string, root?: string): boolean {
  return getClientModuleMetadata(modulePath, root).shouldHydrate;
}

function inspectClientModuleMetadata(
  resolvedPath: string | null,
  root: string | undefined,
  visited: Set<string>,
): ClientModuleMetadata {
  if (!resolvedPath || visited.has(resolvedPath)) {
    return {
      isClientComponent: false,
      shouldHydrate: false,
      islandStrategy: null,
    };
  }

  visited.add(resolvedPath);

  const content = readIfExists(resolvedPath);
  const parsed = parseClientModuleMetadata(content);
  if (parsed.isClientComponent) {
    return {
      isClientComponent: true,
      shouldHydrate: true,
      islandStrategy: parsed.islandStrategy ?? "load",
    };
  }

  let importsClientBoundary = false;
  let importedIslandStrategy: FarmIslandStrategy | null = null;
  for (const specifier of getRelativeImportSpecifiers(content)) {
    const importedPath = resolveImportedModuleSourcePath(resolvedPath, specifier, root);
    const importedMetadata = inspectClientModuleMetadata(importedPath, root, visited);
    if (importedMetadata.isClientComponent || importedMetadata.shouldHydrate) {
      importsClientBoundary = true;
      if (importedIslandStrategy === null) {
        importedIslandStrategy = importedMetadata.islandStrategy;
      } else if (importedIslandStrategy !== importedMetadata.islandStrategy) {
        // One route-level React root cannot honor multiple schedules safely.
        // Fall back to eager hydration when its imported boundaries disagree.
        importedIslandStrategy = "load";
      }
    }
  }

  const shouldHydrate = parsed.hasHydrateExport || importsClientBoundary;

  return {
    isClientComponent: false,
    shouldHydrate,
    islandStrategy: shouldHydrate
      ? (parsed.islandStrategy ?? importedIslandStrategy ?? "load")
      : null,
  };
}

function getRelativeImportSpecifiers(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/g;
  const matches = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1];
    if (!specifier || (!specifier.startsWith(".") && !specifier.startsWith("/"))) {
      continue;
    }
    matches.add(specifier);
  }
  return Array.from(matches);
}

function resolveImportedModuleSourcePath(
  importerPath: string,
  specifier: string,
  root?: string,
): string | null {
  const candidates = new Set<string>();
  const basePath = specifier.startsWith(".")
    ? path.resolve(path.dirname(importerPath), specifier)
    : root
      ? path.resolve(root, specifier.replace(/^\/+/, ""))
      : path.resolve(specifier);

  candidates.add(basePath);
  for (const extension of RESOLVABLE_SOURCE_EXTENSIONS) {
    candidates.add(`${basePath}${extension}`);
    candidates.add(path.join(basePath, `index${extension}`));
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
