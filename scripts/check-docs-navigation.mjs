import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docsRoot = path.join(repositoryRoot, "docs", "src", "app", "docs");
const configPath = path.join(repositoryRoot, "docs", "docs.config.ts");

const pages = collectDocsPages(docsRoot);
const navigation = readNavigationSlugs(configPath);
const visiblePages = new Set(pages.filter((page) => !page.hidden).map((page) => page.slug));
const hiddenPages = new Set(pages.filter((page) => page.hidden).map((page) => page.slug));

const missing = [...visiblePages].filter((slug) => !navigation.has(slug)).sort();
const unknown = [...navigation]
  .filter((slug) => !visiblePages.has(slug) && !hiddenPages.has(slug))
  .sort();

if (missing.length || unknown.length) {
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
  console.error(messages.join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    `Docs navigation covers ${visiblePages.size} visible pages (${hiddenPages.size} explicitly hidden).`,
  );
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
  return /^\s*hidden:\s*true\s*$/m.test(frontmatter);
}

function readNavigationSlugs(filePath) {
  const source = readFileSync(filePath, "utf8");
  const start = source.indexOf("const sidebar = [");
  const end = source.indexOf("] satisfies FarmDocsSidebarItem[];", start);
  if (start === -1 || end === -1) {
    throw new Error(`Could not locate the static sidebar declaration in ${filePath}.`);
  }

  const sidebarSource = source.slice(start, end);
  const slugs = new Set();
  for (const match of sidebarSource.matchAll(/\bslug\s*:\s*["']([^"']*)["']/g)) {
    if (slugs.has(match[1])) {
      throw new Error(`Duplicate docs navigation slug: ${match[1] || "<docs index>"}`);
    }
    slugs.add(match[1]);
  }
  return slugs;
}
