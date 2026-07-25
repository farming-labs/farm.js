import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { APITypeGenerator, type APIRouteInfo } from "./type-generator";
import { generateRouteTypes, type GenerateRouteTypesOptions } from "./routing/generate-route-types";
import { generateEnvTypes } from "./env-types";
import { generateFarmImageTypes } from "./image-types";
import { generateFarmI18nTypes } from "./i18n/type-generator";
import type { ResolvedFarmI18nConfig } from "./i18n/types";
import { getFarmAppDirectories, getFarmSourceRoots, type ResolvedFarmLayer } from "./layers";
import { writeFileIfChanged } from "./write-file-if-changed";

export { generateFarmI18nTypes };

export interface GenerateFarmTypeArtifactsOptions {
  root: string;
  srcDir?: string;
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

  if (shouldGenerateRoutes) {
    const routeOptions: GenerateRouteTypesOptions = {
      root,
      srcDir,
      extraRoutes: options.extraRoutes || [],
      suppressLintOnLink: options.suppressLintOnLink,
      sourceRoots,
    };

    if (options.routeTypesOutFile) {
      routeOptions.outFile = options.routeTypesOutFile;
    }

    result.routeTypesPath = await generateRouteTypes(routeOptions);
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

  if (shouldGenerateEnv) {
    result.envTypesPath = await generateEnvTypes({
      root,
      srcDir,
      outFile: options.envTypesOutFile,
      layerConfigPaths: (options.layers ?? [])
        .map((layer) => layer.configFile)
        .filter((configFile): configFile is string => Boolean(configFile)),
    });
  }

  if (shouldGenerateImages) {
    result.imageTypesPath = generateFarmImageTypes({
      root,
      srcDir,
      outFile: options.imageTypesOutFile,
    });
  }

  if (shouldGenerateI18n && options.i18nConfig) {
    result.i18nTypesPath = await generateFarmI18nTypes({
      root,
      srcDir,
      config: options.i18nConfig,
      outFile: options.i18nTypesOutFile,
    });
  }

  return result;
}
