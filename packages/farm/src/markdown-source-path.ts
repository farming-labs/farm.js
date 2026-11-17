import path from "node:path";

/**
 * The X-Farm-Markdown-Source header is a diagnostic, not a filesystem disclosure: no response, in
 * development or production, carries the machine's absolute path. It names the project-relative
 * path with POSIX separators; a path outside the root falls back to its basename.
 */
export function toBakedMarkdownSourcePath(root: string, filePath: string | undefined): string {
  if (!filePath) return "";
  if (!path.isAbsolute(filePath)) return filePath.split(path.sep).join("/");
  const relative = path.relative(root, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative.split(path.sep).join("/");
}
