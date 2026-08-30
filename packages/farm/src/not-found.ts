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

export function resolveFarmNotFoundComponentPath(
  config: FarmNotFoundPathConfig,
  appDirs: readonly string[],
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
