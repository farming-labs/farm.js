import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  PROGRAMMATIC_ROUTE_FILE_NAMES,
  getProgrammaticRouteManifest,
  scanProgrammaticPagePaths,
  type ProgrammaticRouteManifest,
} from "./routes";

export interface LoadedProgrammaticRouteManifest {
  filePath: string;
  manifest: ProgrammaticRouteManifest;
}

export async function loadProgrammaticRouteManifests(options: {
  root: string;
  srcDir?: string;
  loadModule: (filePath: string) => Promise<Record<string, any>>;
}): Promise<LoadedProgrammaticRouteManifest[]> {
  const manifests: LoadedProgrammaticRouteManifest[] = [];

  for (const filePath of findProgrammaticRouteFiles(options.root, options.srcDir)) {
    const mod = await options.loadModule(filePath);
    const manifest = getProgrammaticRouteManifest(mod);
    if (manifest) {
      manifests.push({ filePath, manifest });
    }
  }

  return manifests;
}

export function findProgrammaticRouteFiles(root: string, srcDir = "src"): string[] {
  return findProgrammaticRouteFilesInDir(join(root, srcDir));
}

export function findProgrammaticRouteFilesInDir(srcRoot: string): string[] {
  const files: string[] = [];

  for (const fileName of PROGRAMMATIC_ROUTE_FILE_NAMES) {
    const filePath = join(srcRoot, fileName);
    if (existsSync(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

export function discoverProgrammaticRoutePaths(root: string, srcDir = "src"): string[] {
  const paths = new Set<string>();

  for (const filePath of findProgrammaticRouteFiles(root, srcDir)) {
    const source = readFileSync(filePath, "utf8");
    for (const routePath of scanProgrammaticPagePaths(source)) {
      paths.add(routePath);
    }
  }

  return Array.from(paths).sort();
}
