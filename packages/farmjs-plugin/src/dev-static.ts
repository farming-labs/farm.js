import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Route segments may legitimately contain dots (e.g. /kinfish/farm.js), so a
 * dot alone cannot classify a dev request as a static asset. A dotted path is
 * only treated as an asset when it maps to a real file under the project root
 * or public dir, matching the filesystem-first behavior of production hosting.
 */
export function devServableFileExists(
  pathname: string,
  baseDirs: Array<string | false | undefined>,
): boolean {
  let decodedPathname: string;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    return false;
  }
  const relativePathname = decodedPathname.replace(/^\/+/, "");
  if (!relativePathname) return false;
  for (const baseDir of baseDirs) {
    if (typeof baseDir !== "string" || baseDir.length === 0) continue;
    const resolvedBase = path.resolve(baseDir);
    const candidate = path.resolve(resolvedBase, relativePathname);
    if (!candidate.startsWith(resolvedBase + path.sep)) continue;
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return true;
      }
    } catch {
      // Ignore filesystem errors and keep checking other base dirs.
    }
  }
  return false;
}
