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

export async function discoverProgrammaticRoutePaths(
  root: string,
  srcDir = "src",
): Promise<string[]> {
  const paths = new Set<string>();
  const files = new Set([
    ...findProgrammaticRouteFiles(root, srcDir),
    ...(await findProgrammaticRouteSourceFiles(join(root, srcDir))),
  ]);

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    for (const routePath of scanProgrammaticPagePaths(source)) {
      paths.add(routePath);
    }
  }

  return Array.from(paths).sort();
}

async function findProgrammaticRouteSourceFiles(srcRoot: string): Promise<string[]> {
  if (!existsSync(srcRoot)) {
    return [];
  }

  try {
    const glob = await import("fast-glob");
    return await glob.default("**/*.{ts,tsx,js,jsx}", {
      cwd: srcRoot,
      absolute: true,
      ignore: [
        "**/*.d.ts",
        "**/node_modules/**",
        "**/.*/**",
        "farm-routes.d.ts",
        "farm-env.d.ts",
        "lib/api.generated.ts",
      ],
    });
  } catch {
    return [];
  }
}
