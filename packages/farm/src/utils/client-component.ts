import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
}

interface ParsedClientModuleMetadata {
  isClientComponent: boolean;
  hasHydrateExport: boolean;
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

export function stripUseClientDirective(content: string): string {
  return content.replace(/^\s*(["'])use client\1\s*;?\s*/, "");
}

function parseClientModuleMetadata(content: string | null): ParsedClientModuleMetadata {
  if (!content) {
    return {
      isClientComponent: false,
      hasHydrateExport: false,
    };
  }

  return {
    isClientComponent: hasUseClientDirective(content),
    hasHydrateExport: hasHydrateExport(content),
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
    };
  }

  visited.add(resolvedPath);

  const content = readIfExists(resolvedPath);
  const parsed = parseClientModuleMetadata(content);
  if (parsed.isClientComponent) {
    return {
      isClientComponent: true,
      shouldHydrate: true,
    };
  }

  let importsClientBoundary = false;
  for (const specifier of getRelativeImportSpecifiers(content)) {
    const importedPath = resolveImportedModuleSourcePath(resolvedPath, specifier, root);
    const importedMetadata = inspectClientModuleMetadata(importedPath, root, visited);
    if (importedMetadata.isClientComponent || importedMetadata.shouldHydrate) {
      importsClientBoundary = true;
      break;
    }
  }

  return {
    isClientComponent: false,
    shouldHydrate: parsed.hasHydrateExport || importsClientBoundary,
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
