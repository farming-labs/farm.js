import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(repositoryRoot, "docs", "src", "app", "docs");
const configPath = path.join(repositoryRoot, "docs", "docs.config.ts");
const packagesRoot = path.join(repositoryRoot, "packages");

const pages = collectDocsPages(docsRoot);
const navigation = readNavigationSlugs(configPath);
const visiblePages = new Set(pages.filter((page) => !page.hidden).map((page) => page.slug));
const hiddenPages = new Set(pages.filter((page) => page.hidden).map((page) => page.slug));
const officialPluginSlugs = collectOfficialPluginSlugs(packagesRoot);

const missing = [...visiblePages].filter((slug) => !navigation.has(slug)).sort();
const unknown = [...navigation]
  .filter((slug) => !visiblePages.has(slug) && !hiddenPages.has(slug))
  .sort();
const missingPluginPages = officialPluginSlugs.filter(
  (slug) => !visiblePages.has(slug) && !hiddenPages.has(slug),
);
const missingPluginNavigation = officialPluginSlugs.filter((slug) => !navigation.has(slug));

if (
  missing.length ||
  unknown.length ||
  missingPluginPages.length ||
  missingPluginNavigation.length
) {
  const messages = ["Farm docs navigation coverage failed."];
  if (missing.length) {
    messages.push(
      "",
      "Pages missing from navigation (add them or set hidden: true in frontmatter):",
      ...missing.map((slug) => `  - /docs/${slug}`.replace(/\/$/, "")),
    );
  }
  if (unknown.length) {
    messages.push(
      "",
      "Navigation entries without a matching docs page:",
      ...unknown.map((slug) => `  - ${slug || "<docs index>"}`),
    );
  }
  if (missingPluginPages.length) {
    messages.push(
      "",
      "Official plugin packages missing a docs page:",
      ...missingPluginPages.map((slug) => `  - /docs/${slug}`),
    );
  }
  if (missingPluginNavigation.length) {
    messages.push(
      "",
      "Official plugin docs missing from the sidebar:",
      ...missingPluginNavigation.map((slug) => `  - /docs/${slug}`),
    );
  }
  console.error(messages.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Docs navigation covers ${visiblePages.size} visible pages and ${officialPluginSlugs.length} official plugins (${hiddenPages.size} explicitly hidden).`,
  );
}

function collectOfficialPluginSlugs(directory) {
  const slugs = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const packageRoot = path.join(directory, entry.name);
    const manifestPath = path.join(packageRoot, "package.json");
    const indexPath = path.join(packageRoot, "src", "index.ts");
    if (!existsSync(manifestPath) || !existsSync(indexPath)) continue;

    const source = readFileSync(indexPath, "utf8");
    if (!/\bname\s*:\s*["'`]farm:[^"'`]+["'`]/.test(source)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.private || typeof manifest.name !== "string") continue;
    if (!manifest.name.startsWith("@farm.js/")) continue;
    slugs.push(`plugins/${manifest.name.slice("@farm.js/".length)}`);
  }
  return slugs.sort();
}

function collectDocsPages(directory) {
  const pages = [];
  const pending = [directory];

  while (pending.length) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
        continue;
      }
      if (entry.name !== "page.md" && entry.name !== "page.mdx") continue;

      const relativeDirectory = path.relative(directory, path.dirname(entryPath));
      const slug = relativeDirectory === "" ? "" : relativeDirectory.replaceAll(path.sep, "/");
      const source = readFileSync(entryPath, "utf8");
      pages.push({ slug, hidden: readHiddenFrontmatter(source) });
    }
  }

  return pages;
}

function readHiddenFrontmatter(source) {
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] || "";
  const value = frontmatter.match(
    /^\s*hidden\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))\s*(?:#.*)?$/im,
  );
  return (value?.[1] || value?.[2] || value?.[3] || "").toLowerCase() === "true";
}

function readNavigationSlugs(filePath) {
  const source = readFileSync(filePath, "utf8");
  const declaration = /\bconst\s+sidebar\s*=\s*\[/.exec(source);
  const end = declaration
    ? /\]\s+satisfies\s+FarmDocsSidebarItem\s*\[\s*\]\s*;?/.exec(source.slice(declaration.index))
    : null;
  if (!declaration || !end) {
    throw new Error(`Could not locate the static sidebar declaration in ${filePath}.`);
  }

  const sidebarSource = source.slice(declaration.index, declaration.index + end.index);
  const slugs = new Set();
  for (const match of sidebarSource.matchAll(/\bslug\s*:\s*["']([^"']*)["']/g)) {
    if (slugs.has(match[1])) {
      throw new Error(`Duplicate docs navigation slug: ${match[1] || "<docs index>"}`);
    }
    slugs.add(match[1]);
  }
  return slugs;
}
