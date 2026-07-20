import { mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { APITypeGenerator, type APIRouteInfo } from "./type-generator";
import { generateRouteTypes, type GenerateRouteTypesOptions } from "./routing/generate-route-types";
import { generateEnvTypes } from "./env-types";
import { generateFarmImageTypes } from "./image-types";
import { getFarmAppDirectories, getFarmSourceRoots, type ResolvedFarmLayer } from "./layers";

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
  routes?: boolean;
  api?: boolean;
  env?: boolean;
  images?: boolean;
}

export interface GenerateFarmTypeArtifactsResult {
  routeTypesPath?: string;
  apiTypesPath?: string;
  envTypesPath?: string;
  imageTypesPath?: string;
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
    writeFileSync(apiTypesPath, content, "utf-8");

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

  return result;
}
