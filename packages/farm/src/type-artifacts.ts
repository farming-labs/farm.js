import { existsSync, mkdirSync, readFileSync, unlinkSync } from "fs";
import { dirname, join, resolve } from "path";
import { APITypeGenerator, type APIRouteInfo } from "./type-generator";
import {
  createRouteTypeDeclarations,
  generateRouteTypes,
  type GenerateRouteTypesOptions,
} from "./routing/generate-route-types";
import { createEnvTypeDeclarations, generateEnvTypes } from "./env-types";
import { generateFarmImageTypes } from "./image-types";
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
}

export interface GenerateFarmTypeArtifactsResult {
  typesPath?: string;
  routeTypesPath?: string;
  apiTypesPath?: string;
  envTypesPath?: string;
  imageTypesPath?: string;
  i18nTypesPath?: string;
  apiRoutes: APIRouteInfo[];
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
      sourceRoots,
    };
    unifiedSections.push(await createRouteTypeDeclarations(routeOptions, unifiedTypesPath));
    result.routeTypesPath = unifiedTypesPath;
  } else if (shouldGenerateRoutes) {
    result.routeTypesPath = await generateRouteTypes({
      root,
      srcDir,
      outFile: options.routeTypesOutFile,
      extraRoutes: options.extraRoutes || [],
      suppressLintOnLink: options.suppressLintOnLink,
      sourceRoots,
    });
  }

  if (shouldGenerateApi) {
    const generator = new APITypeGenerator(appDirs);
    const apiRoutes = generator.scanAPIRoutes();
    const apiTypesPath = options.apiTypesOutFile
      ? resolve(root, options.apiTypesOutFile)
      : join(root, srcDir, "lib", "api.generated.ts");
    const content = generator.generateAPIRouter(apiRoutes, { outFile: apiTypesPath });

    mkdirSync(dirname(apiTypesPath), { recursive: true });
    writeFileIfChanged(apiTypesPath, content);

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
    result.envTypesPath = await generateEnvTypes({
      root,
      srcDir,
      outFile: options.envTypesOutFile,
      configPath: options.configPath,
      layerConfigPaths: (options.layers ?? [])
        .map((layer) => layer.configFile)
        .filter((configFile): configFile is string => Boolean(configFile)),
    });
  }

  // Static image modules are declared by @farm.js/core itself. Keep the
  // explicit output option for callers that need a standalone declaration.
  if (shouldGenerateImages && options.imageTypesOutFile) {
    result.imageTypesPath = generateFarmImageTypes({
      root,
      srcDir,
      outFile: options.imageTypesOutFile,
    });
  }

  if (shouldRefreshUnifiedTypes && options.i18nConfig?.enabled && !options.i18nTypesOutFile) {
    const { signatures } = await readFarmI18nCatalogs(options.i18nConfig);
    unifiedSections.push(renderFarmI18nTypes(options.i18nConfig.locales, signatures));
    result.i18nTypesPath = unifiedTypesPath;
  } else if (shouldGenerateI18n && options.i18nConfig) {
    result.i18nTypesPath = await generateFarmI18nTypes({
      root,
      srcDir,
      config: options.i18nConfig,
      outFile: options.i18nTypesOutFile,
    });
  }

  if (shouldRefreshUnifiedTypes) {
    mkdirSync(dirname(unifiedTypesPath), { recursive: true });
    writeFileIfChanged(
      unifiedTypesPath,
      `/**
 * Generated by Farm.js. Do not edit.
 * Contains project-specific route, environment, and internationalization types.
 */

import "@farm.js/core/image";

${unifiedSections.join("\n")}`,
    );
    result.typesPath = unifiedTypesPath;
    removeLegacyTypeArtifacts(root, srcDir);
  }

  return result;
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
