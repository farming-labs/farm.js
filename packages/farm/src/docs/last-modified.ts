import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

export const FARM_DOCS_LAST_MODIFIED_MANIFEST = ".farm-docs-last-modified.json";

export interface FarmDocsLastModifiedManifest {
  version: 1;
  pages: Record<string, string>;
  /**
   * Committed pages whose last change predates a shallow clone's history. Their date is unknown,
   * so none is shown rather than the clone's oldest commit date or the build time.
   */
  unknown?: string[];
}

export interface CreateFarmDocsLastModifiedManifestOptions {
  fallback?: "mtime" | "now";
  now?: Date;
}

const COMMIT_MARKER = "__FARM_DOCS_COMMIT__";
const DOCS_FILE_EXTENSIONS = new Set([".md", ".mdx"]);
const manifestCache = new Map<
  string,
  {
    signature: string;
    manifest: FarmDocsLastModifiedManifest;
  }
>();

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function resolveExistingPath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isDocsSourceFile(filePath: string): boolean {
  return DOCS_FILE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function discoverDocsSourceFiles(contentDir: string): string[] {
  const files: string[] = [];

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;

      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
      } else if (entry.isFile() && isDocsSourceFile(absolutePath)) {
        files.push(absolutePath);
      }
    }
  };

  if (existsSync(contentDir)) visit(contentDir);
  return files;
}

interface GitLastModifiedDates {
  pages: Record<string, string>;
  /** Pages a shallow clone's history cannot date. */
  unknown: Set<string>;
}

/**
 * The commits a shallow clone's history stops at. Git lists such a commit as adding every file
 * it contains, since its parents are missing, so its file list says nothing about what it changed.
 */
function readShallowBoundaryCommits(gitRoot: string): Set<string> {
  const shallowFile = execFileSync("git", ["-C", gitRoot, "rev-parse", "--git-path", "shallow"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const shallowPath = path.resolve(gitRoot, shallowFile);
  if (!existsSync(shallowPath)) return new Set();
  return new Set(
    readFileSync(shallowPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function getGitLastModifiedDates(contentDir: string): GitLastModifiedDates {
  try {
    const gitRoot = execFileSync("git", ["-C", contentDir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (!gitRoot) return { pages: {}, unknown: new Set() };
    const boundaryCommits = readShallowBoundaryCommits(gitRoot);

    const contentPathspec = normalizeRelativePath(path.relative(gitRoot, contentDir)) || ".";
    const contentPrefix = contentPathspec === "." ? "" : `${contentPathspec}/`;
    const history = execFileSync(
      "git",
      [
        "-C",
        gitRoot,
        "-c",
        "core.quotePath=false",
        "log",
        `--format=${COMMIT_MARKER}%H %cI`,
        "--name-only",
        "--",
        contentPathspec,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 32 * 1024 * 1024,
      },
    );

    const pages: Record<string, string> = {};
    const unknown = new Set<string>();
    let commitDate: string | undefined;
    let isBoundaryCommit = false;

    for (const rawLine of history.split(/\r?\n/)) {
      const line = normalizeRelativePath(rawLine.trim());
      if (!line) continue;

      if (line.startsWith(COMMIT_MARKER)) {
        const [hash, date] = line.slice(COMMIT_MARKER.length).split(" ");
        commitDate = date;
        isBoundaryCommit = boundaryCommits.has(hash);
        continue;
      }
      if (!commitDate || (contentPrefix && !line.startsWith(contentPrefix))) continue;

      const relativePath = contentPrefix ? line.slice(contentPrefix.length) : line;
      if (!isDocsSourceFile(relativePath) || pages[relativePath]) continue;
      if (isBoundaryCommit) unknown.add(relativePath);
      else pages[relativePath] = commitDate;
    }

    for (const relativePath of Object.keys(pages)) unknown.delete(relativePath);
    return { pages, unknown };
  } catch {
    return { pages: {}, unknown: new Set() };
  }
}

function readManifest(contentDir: string): FarmDocsLastModifiedManifest | null {
  const manifestPath = path.join(contentDir, FARM_DOCS_LAST_MODIFIED_MANIFEST);
  if (!existsSync(manifestPath)) return null;

  try {
    const parsed = JSON.parse(
      readFileSync(manifestPath, "utf8"),
    ) as Partial<FarmDocsLastModifiedManifest>;
    if (parsed.version !== 1 || !parsed.pages || typeof parsed.pages !== "object") return null;

    const pages = Object.fromEntries(
      Object.entries(parsed.pages).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
      ),
    );
    const unknown = Array.isArray(parsed.unknown)
      ? parsed.unknown.filter((page): page is string => typeof page === "string")
      : [];
    return { version: 1, pages, ...(unknown.length > 0 ? { unknown } : {}) };
  } catch {
    return null;
  }
}

export function createFarmDocsLastModifiedManifest(
  contentDir: string,
  options: CreateFarmDocsLastModifiedManifestOptions = {},
): FarmDocsLastModifiedManifest {
  const resolvedContentDir = resolveExistingPath(contentDir);
  const gitDates = getGitLastModifiedDates(resolvedContentDir);
  const fallbackDate = (options.now ?? new Date()).toISOString();
  const pages: Record<string, string> = {};
  const unknown: string[] = [];

  for (const sourcePath of discoverDocsSourceFiles(resolvedContentDir)) {
    const relativePath = normalizeRelativePath(path.relative(resolvedContentDir, sourcePath));
    if (gitDates.pages[relativePath]) {
      pages[relativePath] = gitDates.pages[relativePath];
    } else if (gitDates.unknown.has(relativePath)) {
      unknown.push(relativePath);
    } else {
      // Not in Git history at all: a page added since the last commit, or no repository.
      pages[relativePath] =
        options.fallback === "now" ? fallbackDate : statSync(sourcePath).mtime.toISOString();
    }
  }

  return { version: 1, pages, ...(unknown.length > 0 ? { unknown } : {}) };
}

function getLastModifiedManifest(contentDir: string): FarmDocsLastModifiedManifest {
  const resolvedContentDir = resolveExistingPath(contentDir);
  const manifestPath = path.join(resolvedContentDir, FARM_DOCS_LAST_MODIFIED_MANIFEST);
  const manifestStat = existsSync(manifestPath) ? statSync(manifestPath) : null;
  const signature = manifestStat
    ? `file:${manifestStat.mtimeMs}:${manifestStat.size}`
    : "generated";
  const cached = manifestCache.get(resolvedContentDir);
  if (cached?.signature === signature) return cached.manifest;

  const manifest =
    readManifest(resolvedContentDir) ?? createFarmDocsLastModifiedManifest(resolvedContentDir);
  manifestCache.set(resolvedContentDir, { signature, manifest });
  return manifest;
}

/**
 * A page's last-modified date: its frontmatter date, else its last commit, else its file time.
 * `undefined` when the page was last changed before a shallow clone's history begins.
 */
export function resolveFarmDocsPageLastModified(
  contentDir: string,
  sourcePath: string,
  frontmatter: Record<string, string>,
): string | undefined {
  const configured =
    frontmatter.lastModified ||
    frontmatter.lastmod ||
    frontmatter.lastUpdated ||
    frontmatter.updatedAt;
  if (configured) return configured;

  const resolvedContentDir = resolveExistingPath(contentDir);
  const resolvedSourcePath = resolveExistingPath(sourcePath);
  const relativePath = normalizeRelativePath(path.relative(resolvedContentDir, resolvedSourcePath));
  const isInsideContentDir =
    relativePath !== ".." && !relativePath.startsWith("../") && !path.isAbsolute(relativePath);

  if (isInsideContentDir) {
    const manifest = getLastModifiedManifest(resolvedContentDir);
    const generated = manifest.pages[relativePath];
    if (generated) return generated;
    if (manifest.unknown?.includes(relativePath)) return undefined;
  }

  return statSync(resolvedSourcePath).mtime.toISOString();
}
