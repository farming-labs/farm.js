import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { dirname, isAbsolute, join, resolve } from "path";
import { APITypeGenerator, type APIRouteInfo } from "./type-generator";
import {
  createRouteTypeDeclarations,
  generateRouteTypes,
  type GenerateRouteTypesOptions,
} from "./routing/generate-route-types";
import { createEnvTypeDeclarations, generateEnvTypes } from "./env-types";
import { createFarmImageTypeDeclarations, generateFarmImageTypes } from "./image-types";
import { generateFarmI18nTypes, renderFarmI18nTypes } from "./i18n/type-generator";
import { readFarmI18nCatalogs } from "./i18n/catalog";
import type { ResolvedFarmI18nConfig } from "./i18n/types";
import { getFarmAppDirectories, getFarmSourceRoots, type ResolvedFarmLayer } from "./layers";
import { writeFileIfChanged } from "./write-file-if-changed";

export { generateFarmI18nTypes };

export interface GenerateFarmTypeArtifactsOptions {
  root: string;
  srcDir?: string;
  configPath?: string;
  extraRoutes?: string[];
  layers?: readonly ResolvedFarmLayer[];
  suppressLintOnLink?: boolean;
  componentExtensions?: readonly string[];
  routeTypesOutFile?: string;
  apiTypesOutFile?: string;
  envTypesOutFile?: string;
  imageTypesOutFile?: string;
  i18nTypesOutFile?: string;
  i18nConfig?: ResolvedFarmI18nConfig;
  routes?: boolean;
  api?: boolean;
  env?: boolean;
  images?: boolean;
  i18n?: boolean;
  /** Compare generated content with disk without writing files. */
  check?: boolean;
}

export interface GenerateFarmTypeArtifactsResult {
  typesPath?: string;
  routeTypesPath?: string;
  apiTypesPath?: string;
  envTypesPath?: string;
  imageTypesPath?: string;
  i18nTypesPath?: string;
  apiRoutes: APIRouteInfo[];
  /** Generated files whose checked-in content is missing or stale. */
  stalePaths: string[];
}

export async function generateFarmTypeArtifacts(
  options: GenerateFarmTypeArtifactsOptions,
): Promise<GenerateFarmTypeArtifactsResult> {
  const root = resolve(options.root);
  const srcDir = options.srcDir || "src";
  const shouldGenerateRoutes = options.routes !== false;
  const shouldGenerateApi = options.api !== false;
  const shouldGenerateEnv = options.env !== false;
  const shouldGenerateImages = options.images !== false;
  const shouldGenerateI18n = options.i18n !== false && options.i18nConfig?.enabled;
  const sourceRoots = getFarmSourceRoots({ root, srcDir, layers: options.layers });
  const appDirs = getFarmAppDirectories({ root, srcDir, layers: options.layers });

  const result: GenerateFarmTypeArtifactsResult = {
    apiRoutes: [],
    stalePaths: [],
  };
  const unifiedTypesPath = join(root, srcDir, "farm.d.ts");
  const shouldRefreshUnifiedTypes =
    (shouldGenerateRoutes && !options.routeTypesOutFile) ||
    (shouldGenerateEnv && !options.envTypesOutFile) ||
    (shouldGenerateI18n && !options.i18nTypesOutFile);
  const unifiedSections: string[] = [];

  if (shouldRefreshUnifiedTypes && !options.routeTypesOutFile) {
    const routeOptions: GenerateRouteTypesOptions = {
      root,
      srcDir,
      extraRoutes: options.extraRoutes || [],
      suppressLintOnLink: options.suppressLintOnLink,
      componentExtensions: options.componentExtensions,
      sourceRoots,
    };
    unifiedSections.push(await createRouteTypeDeclarations(routeOptions, unifiedTypesPath));
    result.routeTypesPath = unifiedTypesPath;
  } else if (shouldGenerateRoutes) {
    const routeOptions = {
      root,
      srcDir,
      outFile: options.routeTypesOutFile,
      extraRoutes: options.extraRoutes || [],
      suppressLintOnLink: options.suppressLintOnLink,
      componentExtensions: options.componentExtensions,
      sourceRoots,
    } satisfies GenerateRouteTypesOptions;
    if (options.check) {
      const routeTypesPath = resolveGeneratedPath(root, srcDir, options.routeTypesOutFile!);
      const content = await createRouteTypeDeclarations(routeOptions, routeTypesPath);
      checkGeneratedFile(routeTypesPath, content, result.stalePaths);
      result.routeTypesPath = routeTypesPath;
    } else {
      result.routeTypesPath = await generateRouteTypes(routeOptions);
    }
  }

  if (shouldGenerateApi) {
    const generator = new APITypeGenerator(appDirs);
    const apiRoutes = generator.scanAPIRoutes();
    const apiTypesPath = options.apiTypesOutFile
      ? resolve(root, options.apiTypesOutFile)
      : join(root, srcDir, "lib", "api.generated.ts");
    const content = generator.generateAPIRouter(apiRoutes, { outFile: apiTypesPath });

    writeOrCheckGeneratedFile(apiTypesPath, content, options.check, result.stalePaths);

    result.apiTypesPath = apiTypesPath;
    result.apiRoutes = apiRoutes;
  }

  if (shouldRefreshUnifiedTypes && !options.envTypesOutFile) {
    unifiedSections.push(
      createEnvTypeDeclarations(
        {
          root,
          srcDir,
          configPath: options.configPath,
          layerConfigPaths: (options.layers ?? [])
            .map((layer) => layer.configFile)
            .filter((configFile): configFile is string => Boolean(configFile)),
        },
        unifiedTypesPath,
      ),
    );
    result.envTypesPath = unifiedTypesPath;
  } else if (shouldGenerateEnv) {
    const envOptions = {
      root,
      srcDir,
      outFile: options.envTypesOutFile,
      configPath: options.configPath,
      layerConfigPaths: (options.layers ?? [])
        .map((layer) => layer.configFile)
        .filter((configFile): configFile is string => Boolean(configFile)),
    };
    if (options.check) {
      const envTypesPath = resolveGeneratedPath(root, srcDir, options.envTypesOutFile!);
      checkGeneratedFile(
        envTypesPath,
        createEnvTypeDeclarations(envOptions, envTypesPath),
        result.stalePaths,
      );
      result.envTypesPath = envTypesPath;
    } else {
      result.envTypesPath = await generateEnvTypes(envOptions);
    }
  }

  // Static image modules are declared by @farm.js/core itself. Keep the
  // explicit output option for callers that need a standalone declaration.
  if (shouldGenerateImages && options.imageTypesOutFile) {
    const imageTypesPath = resolveGeneratedPath(root, srcDir, options.imageTypesOutFile, false);
    if (options.check) {
      checkGeneratedFile(imageTypesPath, createFarmImageTypeDeclarations(), result.stalePaths);
      result.imageTypesPath = imageTypesPath;
    } else {
      result.imageTypesPath = generateFarmImageTypes({
        root,
        srcDir,
        outFile: options.imageTypesOutFile,
      });
    }
  }

  if (shouldRefreshUnifiedTypes && options.i18nConfig?.enabled && !options.i18nTypesOutFile) {
    const { signatures } = await readFarmI18nCatalogs(options.i18nConfig);
    unifiedSections.push(renderFarmI18nTypes(options.i18nConfig.locales, signatures));
    result.i18nTypesPath = unifiedTypesPath;
  } else if (shouldGenerateI18n && options.i18nConfig) {
    if (options.check) {
      const i18nTypesPath = resolveGeneratedPath(root, srcDir, options.i18nTypesOutFile!, false);
      const { signatures } = await readFarmI18nCatalogs(options.i18nConfig);
      checkGeneratedFile(
        i18nTypesPath,
        renderFarmI18nTypes(options.i18nConfig.locales, signatures),
        result.stalePaths,
      );
      result.i18nTypesPath = i18nTypesPath;
    } else {
      result.i18nTypesPath = await generateFarmI18nTypes({
        root,
        srcDir,
        config: options.i18nConfig,
        outFile: options.i18nTypesOutFile,
      });
    }
  }

  if (shouldRefreshUnifiedTypes) {
    writeOrCheckGeneratedFile(
      unifiedTypesPath,
      `/**
 * Generated by Farm.js. Do not edit.
 * Contains project-specific route, environment, and internationalization types.
 */

import "@farm.js/core/image";
import "@farm.js/core/css";

${unifiedSections.map(normalizeUnifiedTypeSection).join("\n\n")}
`,
      options.check,
      result.stalePaths,
    );
    result.typesPath = unifiedTypesPath;
    if (options.check) {
      collectLegacyTypeArtifacts(root, srcDir, result.stalePaths);
    } else {
      removeLegacyTypeArtifacts(root, srcDir);
    }
  }

  return result;
}

function normalizeUnifiedTypeSection(section: string): string {
  // The unified artifact already imports Farm's asset types, so it is a module.
  // Individual generators add this marker for standalone declaration files, but
  // formatters remove the now-redundant export and make `farm generate --check`
  // report a false stale-file failure.
  return section.trimEnd().replace(/\n+export \{\};$/, "");
}

function resolveGeneratedPath(
  root: string,
  srcDir: string,
  outFile: string,
  relativeToSrc = true,
): string {
  if (isAbsolute(outFile)) return resolve(outFile);
  return resolve(root, relativeToSrc ? join(srcDir, outFile) : outFile);
}

function writeOrCheckGeneratedFile(
  filePath: string,
  content: string,
  check: boolean | undefined,
  stalePaths: string[],
): void {
  if (check) {
    checkGeneratedFile(filePath, content, stalePaths);
    return;
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileIfChanged(filePath, content);
}

function checkGeneratedFile(filePath: string, content: string, stalePaths: string[]): void {
  if (!existsSync(filePath) || readFileSync(filePath, "utf8") !== content) {
    stalePaths.push(filePath);
  }
}

const LEGACY_TYPE_ARTIFACTS = [
  ["farm-routes.d.ts", "Auto-generated route types"],
  ["farm-env.d.ts", "Auto-generated env types"],
  ["farm-images.d.ts", "Generated by Farm.js"],
  ["farm-i18n.d.ts", "Generated by Farm.js"],
] as const;

function removeLegacyTypeArtifacts(root: string, srcDir: string): void {
  for (const [fileName, marker] of LEGACY_TYPE_ARTIFACTS) {
    const filePath = join(root, srcDir, fileName);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    if (source.includes(marker)) {
      unlinkSync(filePath);
    }
  }
}

function collectLegacyTypeArtifacts(root: string, srcDir: string, stalePaths: string[]): void {
  for (const [fileName, marker] of LEGACY_TYPE_ARTIFACTS) {
    const filePath = join(root, srcDir, fileName);
    if (!existsSync(filePath)) continue;
    if (readFileSync(filePath, "utf8").includes(marker)) stalePaths.push(filePath);
  }
}
