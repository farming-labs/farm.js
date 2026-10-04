import { readFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import {
  createFarmMarkdownRouteModule,
  type FarmMarkdownPageModuleInput,
} from "./app-markdown-runtime";
import {
  resolveMdxConfig,
  type FarmMdxComponents,
  type FarmMdxResolvedConfig,
} from "./app-markdown-config";

export * from "./app-markdown-runtime";
export {
  resolveFarmMdxComponentsModulePath,
  resolveMdxConfig,
  type FarmMdxComponent,
  type FarmMdxComponents,
  type FarmMdxResolvedConfig,
  type FarmMdxUserConfig,
} from "./app-markdown-config";

export async function createFarmMarkdownRouteModuleFromFile(
  filePath: string,
  options: {
    components?: FarmMdxComponents;
    config?: FarmMdxResolvedConfig;
  } = {},
) {
  const source = await readFile(filePath, "utf8");
  return createFarmMarkdownRouteModule({
    source,
    filePath,
    components: options.components,
    config: options.config,
  } satisfies FarmMarkdownPageModuleInput);
}

export async function loadFarmMdxComponents(
  config: FarmMdxResolvedConfig | undefined,
  options: {
    root: string;
    loadModule?: (modulePath: string) => Promise<unknown>;
  },
): Promise<FarmMdxComponents> {
  const configured = config?.components;
  if (!configured) {
    return {};
  }

  if (typeof configured !== "string") {
    return configured;
  }

  const modulePath = path.isAbsolute(configured) ? configured : path.join(options.root, configured);
  const mod = options.loadModule
    ? await options.loadModule(modulePath)
    : await import(pathToFileURL(modulePath).href);
  const maybeModule = mod as {
    components?: FarmMdxComponents;
    default?: FarmMdxComponents;
  };

  return maybeModule.components || maybeModule.default || {};
}
