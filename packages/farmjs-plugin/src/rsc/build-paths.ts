import path from "path";

/** Resolve a Vite environment outDir without prefixing an already-absolute path. */
export function resolveRscBuildOutputPath(
  root: string,
  outDir: string,
  ...segments: string[]
): string {
  const resolvedOutDir = path.isAbsolute(outDir)
    ? path.normalize(outDir)
    : path.resolve(root, outDir);
  return path.join(resolvedOutDir, ...segments);
}
