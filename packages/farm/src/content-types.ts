import * as fs from "node:fs";
import * as path from "node:path";

export interface CreateContentTypeDeclarationsOptions {
  root: string;
  configPath?: string;
  /** Lower-priority layer config files, ordered before the project config. */
  layerConfigPaths?: readonly string[];
}

const CONFIG_FILENAMES = [
  "farm.config.ts",
  "farm.config.tsx",
  "farm.config.mts",
  "farm.config.cts",
  "farm.config.js",
  "farm.config.jsx",
  "farm.config.mjs",
  "farm.config.cjs",
  "config.ts",
  "config.tsx",
  "config.mts",
  "config.cts",
  "config.js",
  "config.jsx",
  "config.mjs",
  "config.cjs",
];

/** Infer content collection names and entry data from content() in Farm config. */
export function createContentTypeDeclarations(
  options: CreateContentTypeDeclarationsOptions,
  outPath: string,
): string {
  const root = path.resolve(options.root);
  const projectConfig = findConfigPath(root, options.configPath);
  const configPaths = [
    ...(options.layerConfigPaths ?? []).filter((value) => fs.existsSync(value)),
    ...(projectConfig ? [projectConfig] : []),
  ];

  if (configPaths.length === 0) return createEmptyContentTypes();

  const imports = configPaths
    .map(
      (configPath, index) =>
        `import type FarmContentConfig${index} from ${JSON.stringify(toTypeImportPath(outPath, configPath))};`,
    )
    .join("\n");
  const registries = configPaths
    .map(
      (_configPath, index) =>
        `type FarmContentRegistry${index} = ContentRegistryFromConfig<typeof FarmContentConfig${index}>;`,
    )
    .join("\n");
  const registryUnion = configPaths
    .map((_configPath, index) => `FarmContentRegistry${index}`)
    .join(" | ");

  return `/**
 * Auto-generated content collection types from Farm layers and farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
${imports}

type FarmContentPluginFromConfig<TConfig> = TConfig extends {
  plugins?: readonly (infer TPlugin)[];
}
  ? Extract<TPlugin, { readonly __farmContentRegistry: Record<string, unknown> }>
  : never;
type ContentRegistryFromConfig<TConfig> =
  FarmContentPluginFromConfig<TConfig> extends {
    readonly __farmContentRegistry: infer TRegistry;
  }
    ? TRegistry
    : never;
type FarmContentUnionToIntersection<TValue> = (
  TValue extends unknown ? (value: TValue) => void : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;
${registries}

type FarmResolvedContentRegistry = [${registryUnion}] extends [never]
  ? {}
  : FarmContentUnionToIntersection<${registryUnion}>;

declare global {
  namespace FarmJS {
    interface ContentRegistry {
      collections: FarmResolvedContentRegistry;
    }
  }
}

export {};
`;
}

function createEmptyContentTypes(): string {
  return `/**
 * Auto-generated content collection types from farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
declare global {
  namespace FarmJS {
    interface ContentRegistry {
      collections: {};
    }
  }
}

export {};
`;
}

function findConfigPath(root: string, configPath?: string): string | null {
  if (configPath) {
    const resolvedPath = path.isAbsolute(configPath) ? configPath : path.join(root, configPath);
    return fs.existsSync(resolvedPath) ? resolvedPath : null;
  }
  for (const filename of CONFIG_FILENAMES) {
    const resolvedPath = path.join(root, filename);
    if (fs.existsSync(resolvedPath)) return resolvedPath;
  }
  return null;
}

function toTypeImportPath(outPath: string, targetPath: string): string {
  const relativePath = path
    .relative(path.dirname(outPath), targetPath)
    .replace(/\\/g, "/")
    .replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/, "");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}
