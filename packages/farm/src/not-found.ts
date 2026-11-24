import fs from "node:fs";
import path from "node:path";
import { getFarmRendererComponentExtensions, type FarmRenderer } from "./renderer";

interface FarmNotFoundPathConfig {
  root: string;
  renderer: FarmRenderer;
  notFound?: {
    component?: string;
  };
}

/**
 * The app's not-found page: `notFound.component`, else the one the renderer's route rules mapped
 * (`discovered`, when the renderer has `routes()`), else `not-found.*` in an app directory.
 */
export function resolveFarmNotFoundComponentPath(
  config: FarmNotFoundPathConfig,
  appDirs: readonly string[],
  discovered?: string | null,
): string | null {
  const extensions = getFarmRendererComponentExtensions(config.renderer);
  const configuredPath = config.notFound?.component?.trim();

  if (configuredPath) {
    const componentPath = path.isAbsolute(configuredPath)
      ? path.normalize(configuredPath)
      : path.resolve(config.root, configuredPath);
    if (!extensions.some((extension) => componentPath.endsWith(extension))) {
      throw new Error(
        `notFound.component must use one of the configured renderer extensions: ${extensions.join(", ")}`,
      );
    }
    if (!fs.existsSync(componentPath) || !fs.statSync(componentPath).isFile()) {
      throw new Error(`notFound.component was not found: ${componentPath}`);
    }
    return componentPath;
  }
  if (discovered !== undefined) return discovered;

  let discoveredPath: string | null = null;
  for (const appDir of appDirs) {
    for (const extension of extensions) {
      const candidate = path.join(appDir, `not-found${extension}`);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        discoveredPath = candidate;
        break;
      }
    }
  }
  return discoveredPath;
}
