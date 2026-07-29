import * as fs from "fs";
import * as path from "path";
import { writeFileIfChanged } from "./write-file-if-changed";

export interface GenerateEnvTypesOptions {
  root: string;
  srcDir?: string;
  outFile?: string;
  configPath?: string;
  /** Lower-priority layer config files, ordered before the project config. */
  layerConfigPaths?: readonly string[];
}

const DEFAULT_OUT_FILE = "farm-env.d.ts";
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

export async function generateEnvTypes(options: GenerateEnvTypesOptions): Promise<string> {
  const root = path.resolve(options.root);
  const srcDir = options.srcDir || "src";
  const outPath = path.join(root, srcDir, options.outFile || DEFAULT_OUT_FILE);
  const configPath = findConfigPath(root, options.configPath);
  const configPaths = [
    ...(options.layerConfigPaths ?? []).filter((value) => fs.existsSync(value)),
    ...(configPath ? [configPath] : []),
  ];
  const content =
    configPaths.length > 1
      ? createLayeredConfigBackedEnvTypes(outPath, configPaths)
      : configPaths.length === 1
        ? createConfigBackedEnvTypes(outPath, configPaths[0])
        : createEmptyEnvTypes();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileIfChanged(outPath, content);

  return outPath;
}

function createLayeredConfigBackedEnvTypes(outPath: string, configPaths: string[]): string {
  const imports = configPaths
    .map(
      (configPath, index) =>
        `import type FarmConfig${index} from ${JSON.stringify(toTypeImportPath(outPath, configPath))};`,
    )
    .join("\n");
  const resolvedTypes = configPaths
    .map(
      (_configPath, index) => `
type FarmConfigEnv${index} = typeof FarmConfig${index} extends { env?: infer TEnv }
  ? NonNullable<TEnv>
  : never;
type FarmResolvedEnv${index} = [FarmConfigEnv${index}] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv${index}>;`,
    )
    .join("\n");
  const mergedTypes = configPaths
    .slice(1)
    .map(
      (_configPath, index) =>
        `type FarmMergedEnv${index + 1} = MergeFarmEnv<${index === 0 ? "FarmResolvedEnv0" : `FarmMergedEnv${index}`}, FarmResolvedEnv${index + 1}>;`,
    )
    .join("\n");
  const finalType = `FarmMergedEnv${configPaths.length - 1}`;

  return `/**
 * Auto-generated env types from Farm layers and farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
${imports}
import type { InferEnv } from "@farm.js/core/env";

type MergeFarmEnv<TBase, TOverride> = {
  server: Omit<TBase extends { server: infer T } ? T : {}, keyof (TOverride extends { server: infer T } ? T : {})> &
    (TOverride extends { server: infer T } ? T : {});
  public: Omit<TBase extends { public: infer T } ? T : {}, keyof (TOverride extends { public: infer T } ? T : {})> &
    (TOverride extends { public: infer T } ? T : {});
};
${resolvedTypes}
${mergedTypes}

type FarmResolvedEnv = ${finalType};

declare module "@farm.js/core/env" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

declare module "@farm.js/core" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
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
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath;
    }
  }

  return null;
}

function createConfigBackedEnvTypes(outPath: string, configPath: string): string {
  const configImportPath = toTypeImportPath(outPath, configPath);

  return `/**
 * Auto-generated env types from farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
import type FarmConfig from ${JSON.stringify(configImportPath)};
import type { InferEnv } from "@farm.js/core/env";

type FarmConfigEnv = typeof FarmConfig extends { env?: infer TEnv } ? NonNullable<TEnv> : never;
type FarmResolvedEnv = [FarmConfigEnv] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv>;

declare module "@farm.js/core/env" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

declare module "@farm.js/core" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

export {};
`;
}

function createEmptyEnvTypes(): string {
  return `/**
 * Auto-generated env types from farm.config.
 * Regenerated on dev start, build, and farm generate.
 */
declare module "@farm.js/core/env" {
  interface FarmEnvTypes {
    server: {};
    public: {};
  }
}

declare module "@farm.js/core" {
  interface FarmEnvTypes {
    server: {};
    public: {};
  }
}

export {};
`;
}

function toTypeImportPath(outPath: string, targetPath: string): string {
  const relativePath = path
    .relative(path.dirname(outPath), targetPath)
    .replace(/\\/g, "/")
    .replace(/\.(tsx?|jsx?|mjs|cjs|mts|cts)$/, "");

  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}
