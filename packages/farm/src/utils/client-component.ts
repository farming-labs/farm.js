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

interface ModuleSourceToken {
  kind: "identifier" | "string" | "punctuation";
  value: string;
  line: number;
}

function tokenizeModuleSource(content: string): ModuleSourceToken[] {
  const tokens: ModuleSourceToken[] = [];
  let index = 0;
  let line = 1;

  while (index < content.length) {
    const character = content[index];
    if (/\s/.test(character)) {
      if (character === "\n") line++;
      index++;
      continue;
    }

    if (character === "/" && content[index + 1] === "/") {
      index += 2;
      while (index < content.length && content[index] !== "\n") index++;
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      index += 2;
      while (index < content.length) {
        if (content[index] === "\n") line++;
        if (content[index] === "*" && content[index + 1] === "/") {
          index += 2;
          break;
        }
        index++;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      const quote = character;
      const tokenLine = line;
      let value = "";
      index++;
      while (index < content.length) {
        const next = content[index];
        if (next === "\\") {
          value += next;
          if (index + 1 < content.length) value += content[index + 1];
          index += 2;
          continue;
        }
        if (next === quote) {
          index++;
          break;
        }
        if (next === "\n") line++;
        value += next;
        index++;
      }
      tokens.push({ kind: "string", value, line: tokenLine });
      continue;
    }

    if (character === "`") {
      index++;
      while (index < content.length) {
        const next = content[index];
        if (next === "\\") {
          index += 2;
          continue;
        }
        if (next === "`") {
          index++;
          break;
        }
        if (next === "\n") line++;
        index++;
      }
      continue;
    }

    if (/[A-Za-z_$]/.test(character)) {
      const start = index++;
      while (index < content.length && /[\w$]/.test(content[index])) index++;
      tokens.push({ kind: "identifier", value: content.slice(start, index), line });
      continue;
    }

    tokens.push({ kind: "punctuation", value: character, line });
    index++;
  }

  return tokens;
}

function isIslandExportStart(tokens: ModuleSourceToken[], index: number): boolean {
  const token = tokens[index];
  const previous = tokens[index - 1];
  const startsStatement =
    !previous ||
    previous.value === ";" ||
    previous.value === "{" ||
    previous.value === "}" ||
    token.line > previous.line;
  return (
    startsStatement &&
    token.value === "export" &&
    tokens[index + 1]?.value === "const" &&
    tokens[index + 2]?.value === "island"
  );
}

export function getIslandStrategyExport(content: string | null): FarmIslandStrategy | null {
  if (!content) return null;

  const tokens = tokenizeModuleSource(content);
  for (let index = 0; index < tokens.length - 2; index++) {
    if (!isIslandExportStart(tokens, index)) continue;

    let valueIndex = index + 3;
    if (tokens[valueIndex]?.value === ":") {
      while (valueIndex < tokens.length && tokens[valueIndex].value !== "=") valueIndex++;
    }
    if (tokens[valueIndex]?.value !== "=") break;
    valueIndex++;

    const literal = tokens[valueIndex];
    if (!literal || literal.kind !== "string" || !isFarmIslandStrategy(literal.value)) break;

    let trailingIndex = valueIndex + 1;
    if (tokens[trailingIndex]?.value === "as" && tokens[trailingIndex + 1]?.value === "const") {
      trailingIndex += 2;
    }
    const trailing = tokens[trailingIndex];
    if (trailing && trailing.value !== ";" && trailing.line === literal.line) break;
    return literal.value;
  }

  if (tokens.some((_token, index) => isIslandExportStart(tokens, index))) {
    throw new Error(
      'Farm island configuration must be a static "load", "interaction", "visible", or "idle" string literal.',
    );
  }

  return null;
}

export function stripUseClientDirective(content: string): string {
  return content.replace(/^\s*(["'])use client\1\s*;?\s*/, "");
}

function parseClientModuleMetadata(
  content: string | null,
  inspectIslandExport: boolean,
): ParsedClientModuleMetadata {
  if (!content) {
    return {
      isClientComponent: false,
      hasHydrateExport: false,
      islandStrategy: null,
    };
  }

  const isClientComponent = hasUseClientDirective(content);
  const hasHydrate = hasHydrateExport(content);
  return {
    isClientComponent,
    hasHydrateExport: hasHydrate,
    islandStrategy:
      inspectIslandExport || isClientComponent || hasHydrate
        ? getIslandStrategyExport(content)
        : null,
  };
}

export function getClientModuleMetadata(modulePath: string, root?: string): ClientModuleMetadata {
  const resolvedPath = resolveModuleSourcePath(modulePath, root);
  return inspectClientModuleMetadata(resolvedPath, root, new Set(), true);
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
  inspectIslandExport: boolean,
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
  const parsed = parseClientModuleMetadata(content, inspectIslandExport);
  if (parsed.isClientComponent) {
    return {
      isClientComponent: true,
      shouldHydrate: true,
      islandStrategy: parsed.islandStrategy ?? "load",
    };
  }

  let importsClientBoundary = false;
  let importedIslandStrategy: FarmIslandStrategy | null = null;
  for (const specifier of getImportSpecifiers(content)) {
    const importedPath = resolveImportedModuleSourcePath(resolvedPath, specifier, root);
    const importedMetadata =
      !specifier.startsWith(".") && !specifier.startsWith("/")
        ? inspectPackageClientBoundary(importedPath)
        : inspectClientModuleMetadata(importedPath, root, visited, false);
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

function inspectPackageClientBoundary(resolvedPath: string | null): ClientModuleMetadata {
  const parsed = parseClientModuleMetadata(
    resolvedPath ? readIfExists(resolvedPath) : null,
    false,
  );
  const shouldHydrate = parsed.isClientComponent || parsed.hasHydrateExport;
  return {
    isClientComponent: parsed.isClientComponent,
    shouldHydrate,
    islandStrategy: shouldHydrate ? (parsed.islandStrategy ?? "load") : null,
  };
}

function getImportSpecifiers(content: string | null): string[] {
  if (!content) {
    return [];
  }

  const pattern =
    /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?(?:[^"'`]+?\s+from\s+)?["']([^"']+)["']/g;
  const matches = new Set<string>();
  for (const match of content.matchAll(pattern)) {
    const specifier = match[1];
    if (!specifier || specifier.startsWith("node:") || specifier.includes("?")) {
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
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return resolvePackageModuleSourcePath(importerPath, specifier, root);
  }

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

function resolvePackageModuleSourcePath(
  importerPath: string,
  specifier: string,
  root?: string,
): string | null {
  const packageParts = specifier.split("/");
  const packageName = specifier.startsWith("@")
    ? packageParts.slice(0, 2).join("/")
    : packageParts[0];
  const packageSubpath = packageParts.slice(packageName.startsWith("@") ? 2 : 1).join("/");
  const packageDirectory = findPackageDirectory(importerPath, packageName, root);
  if (!packageDirectory) return null;

  const packageJsonPath = path.join(packageDirectory, "package.json");
  const packageJson = readPackageJson(packageJsonPath);
  const exportKey = packageSubpath ? `./${packageSubpath}` : ".";
  const exportTarget = resolvePackageExport(packageJson?.exports, exportKey);
  const candidates = new Set<string>();

  if (exportTarget?.startsWith("./")) {
    candidates.add(path.resolve(packageDirectory, exportTarget));
  }
  if (packageSubpath) {
    candidates.add(path.join(packageDirectory, packageSubpath));
  } else {
    for (const entry of [packageJson?.browser, packageJson?.module, packageJson?.main]) {
      if (typeof entry === "string") candidates.add(path.resolve(packageDirectory, entry));
    }
    candidates.add(path.join(packageDirectory, "index"));
  }

  return resolveSourceCandidate(candidates);
}

function findPackageDirectory(
  importerPath: string,
  packageName: string,
  root?: string,
): string | null {
  const searchRoots = new Set<string>();
  let current = path.dirname(importerPath);
  while (true) {
    searchRoots.add(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (root) {
    current = path.resolve(root);
    while (true) {
      searchRoots.add(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  for (const searchRoot of searchRoots) {
    const packageDirectory = path.join(searchRoot, "node_modules", packageName);
    if (fs.existsSync(path.join(packageDirectory, "package.json"))) {
      return packageDirectory;
    }
  }
  return null;
}

function readPackageJson(packageJsonPath: string): Record<string, any> | null {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  } catch {
    return null;
  }
}

function resolvePackageExport(exportsField: unknown, exportKey: string): string | null {
  if (typeof exportsField === "string") {
    return exportKey === "." ? exportsField : null;
  }
  if (Array.isArray(exportsField)) {
    for (const candidate of exportsField) {
      const resolved = resolvePackageExport(candidate, exportKey);
      if (resolved) return resolved;
    }
    return null;
  }
  if (!exportsField || typeof exportsField !== "object") return null;

  const entries = Object.entries(exportsField as Record<string, unknown>);
  const subpathExports = entries.some(([key]) => key.startsWith("."));
  if (subpathExports) {
    const exact = (exportsField as Record<string, unknown>)[exportKey];
    if (exact !== undefined) return resolveConditionalExportTarget(exact);

    for (const [key, value] of entries) {
      const wildcardIndex = key.indexOf("*");
      if (wildcardIndex === -1) continue;
      const prefix = key.slice(0, wildcardIndex);
      const suffix = key.slice(wildcardIndex + 1);
      if (!exportKey.startsWith(prefix) || !exportKey.endsWith(suffix)) continue;
      const wildcard = exportKey.slice(prefix.length, exportKey.length - suffix.length);
      const target = resolveConditionalExportTarget(value);
      return target?.replace("*", wildcard) ?? null;
    }
    return null;
  }

  return exportKey === "." ? resolveConditionalExportTarget(exportsField) : null;
}

function resolveConditionalExportTarget(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const resolved = resolveConditionalExportTarget(candidate);
      if (resolved) return resolved;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;

  const conditions = value as Record<string, unknown>;
  for (const condition of ["browser", "import", "module", "default", "require"]) {
    if (conditions[condition] === undefined) continue;
    const resolved = resolveConditionalExportTarget(conditions[condition]);
    if (resolved) return resolved;
  }
  return null;
}

function resolveSourceCandidate(candidates: Iterable<string>): string | null {
  for (const candidate of candidates) {
    const paths = [candidate];
    for (const extension of RESOLVABLE_SOURCE_EXTENSIONS) {
      paths.push(`${candidate}${extension}`, path.join(candidate, `index${extension}`));
    }
    for (const sourcePath of paths) {
      try {
        if (fs.statSync(sourcePath).isFile()) return sourcePath;
      } catch {
        // Continue to the next candidate.
      }
    }
  }
  return null;
}
