import * as fs from "fs";
import * as path from "path";

export interface GenerateEnvTypesOptions {
  root: string;
  srcDir?: string;
  outFile?: string;
  configPath?: string;
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
  const content = configPath
    ? createConfigBackedEnvTypes(outPath, configPath)
    : createEmptyEnvTypes();

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf8");

  return outPath;
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
import type { InferEnv } from "@farmjs/core/env";

type FarmConfigEnv = typeof FarmConfig extends { env?: infer TEnv } ? NonNullable<TEnv> : never;
type FarmResolvedEnv = [FarmConfigEnv] extends [never]
  ? { server: {}; public: {} }
  : InferEnv<FarmConfigEnv>;

declare module "@farmjs/core/env" {
  interface FarmEnvTypes {
    server: FarmResolvedEnv["server"];
    public: FarmResolvedEnv["public"];
  }
}

declare module "@farmjs/core" {
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
declare module "@farmjs/core/env" {
  interface FarmEnvTypes {
    server: {};
    public: {};
  }
}

declare module "@farmjs/core" {
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
