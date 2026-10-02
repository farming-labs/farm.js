/**
 * llms.txt (https://llmstxt.org): a Markdown index at `/llms.txt` that tells
 * language models what a site is and where its readable pages live.
 *
 * `agent.llmsTxt` in farm.config.ts serves a generated index of the app's static
 * pages. A `src/app/llms.ts` metadata route replaces it with whatever it returns,
 * and receives the generated pages and defaults to build on. The development
 * renderer and the generated production server both call into this module, so
 * the two serve the same file.
 */
import { applyFarmBasePath } from "./base-path";
import {
  getFarmMarkdownMirrorPath,
  isFarmMarkdownMirrorExposed,
  matchesFarmMarkdownRoutePattern,
  type FarmMarkdownResolvedConfig,
} from "./markdown";

export interface FarmLlmsTxtLink {
  title: string;
  url: string;
  description?: string;
}

export interface FarmLlmsTxtSection {
  title: string;
  links: FarmLlmsTxtLink[];
}

export interface FarmLlmsTxt {
  /** Site or project name, rendered as the `# H1`. Required by the format. */
  title: string;
  /** One-sentence summary, rendered as a `> blockquote`. */
  summary?: string;
  /** Free-form Markdown placed after the summary. */
  details?: string;
  /** `## H2` sections of links. A section titled "Optional" marks skippable links. */
  sections?: FarmLlmsTxtSection[];
}

/** A static page of the app, ready to use as an llms.txt link. */
export interface FarmLlmsTxtPage extends FarmLlmsTxtLink {
  /** The page's route path, such as `/docs/install`. */
  path: string;
}

export interface FarmLlmsTxtUserConfig {
  /** Set to `false` to turn llms.txt off while keeping these options. */
  enabled?: boolean;
  /** Site name for the `# H1`. Defaults to the root layout's metadata title. */
  title?: string;
  /** Summary for the `> blockquote`. Defaults to the root layout's metadata description. */
  summary?: string;
  /** Markdown placed after the summary. */
  details?: string;
  /**
   * Route patterns to list, using the same syntax as `md.expose`
   * (`/docs/[...slug]`). Defaults to every static page.
   */
  include?: string[];
  /** Route patterns to leave out, such as `/admin/[...path]`. */
  exclude?: string[];
}

export interface ResolvedFarmLlmsTxtConfig {
  enabled: boolean;
  title?: string;
  summary?: string;
  details?: string;
  include: string[];
  exclude: string[];
}

export interface FarmLlmsTxtPageSource {
  pattern: string;
  metadata?: unknown;
}

export function resolveFarmLlmsTxtConfig(
  input: boolean | FarmLlmsTxtUserConfig | undefined,
): ResolvedFarmLlmsTxtConfig {
  if (!input) return { enabled: false, include: [], exclude: [] };
  if (input === true) return { enabled: true, include: [], exclude: [] };
  if (typeof input !== "object") {
    throw new TypeError("agent.llmsTxt must be true, false, or an options object.");
  }
  // Also accepts its own output, so already-resolved config passes through unchanged.
  if (input.enabled === false) return { enabled: false, include: [], exclude: [] };

  for (const key of ["title", "summary", "details"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "string") {
      throw new TypeError(`agent.llmsTxt.${key} must be a string.`);
    }
  }

  return {
    enabled: true,
    ...(input.title ? { title: input.title } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
    ...(input.details ? { details: input.details } : {}),
    include: resolveRoutePatterns(input.include, "include"),
    exclude: resolveRoutePatterns(input.exclude, "exclude"),
  };
}

function resolveRoutePatterns(value: unknown, key: "include" | "exclude"): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new TypeError(`agent.llmsTxt.${key} must be an array of route patterns.`);
  }
  return value.map((pattern, index) => {
    if (typeof pattern !== "string" || !pattern.startsWith("/")) {
      throw new TypeError(
        `agent.llmsTxt.${key}[${index}] must be a route pattern starting with "/", such as "/docs/[...slug]".`,
      );
    }
    return pattern;
  });
}

export function collectFarmLlmsTxtPages(
  sources: Iterable<FarmLlmsTxtPageSource>,
  options: {
    origin: string;
    basePath?: string;
    markdown?: FarmMarkdownResolvedConfig;
    include?: string[];
    exclude?: string[];
  },
): FarmLlmsTxtPage[] {
  const include = options.include ?? [];
  const exclude = options.exclude ?? [];
  const pages = new Map<string, FarmLlmsTxtPage>();

  for (const source of sources) {
    const path = source.pattern;
    // Dynamic routes have no single URL to list; an llms.ts can add their pages.
    if (path.includes("[") || pages.has(path)) continue;
    if (
      include.length &&
      !include.some((pattern) => matchesFarmMarkdownRoutePattern(pattern, path))
    ) {
      continue;
    }
    if (exclude.some((pattern) => matchesFarmMarkdownRoutePattern(pattern, path))) continue;

    // llmstxt.org prefers links to Markdown; use the page's mirror when it has one.
    const target = isFarmMarkdownMirrorExposed(options.markdown, path)
      ? getFarmMarkdownMirrorPath(path)
      : path;
    const description = readMetadataString(source.metadata, "description");
    pages.set(path, {
      path,
      title: readMetadataTitle(source.metadata) ?? fallbackPageTitle(path),
      url: `${options.origin}${applyFarmBasePath(target, options.basePath)}`,
      ...(description ? { description } : {}),
    });
  }

  return [...pages.values()].sort((left, right) => left.path.localeCompare(right.path));
}

export function createFarmDefaultLlmsTxt(options: {
  origin: string;
  pages: FarmLlmsTxtPage[];
  config: ResolvedFarmLlmsTxtConfig;
  rootMetadata?: unknown;
}): FarmLlmsTxt {
  const { config, pages } = options;
  const summary = config.summary ?? readMetadataString(options.rootMetadata, "description");

  return {
    title:
      config.title ??
      readMetadataTitle(options.rootMetadata) ??
      pages.find((page) => page.path === "/")?.title ??
      new URL(options.origin).host,
    ...(summary ? { summary } : {}),
    ...(config.details ? { details: config.details } : {}),
    sections: pages.length
      ? [
          {
            title: "Pages",
            links: pages.map(({ title, url, description }) => ({
              title,
              url,
              ...(description ? { description } : {}),
            })),
          },
        ]
      : [],
  };
}

export function serializeFarmLlmsTxt(value: unknown): string {
  // A string is the complete file, written by hand; serve it as-is.
  if (typeof value === "string") {
    if (!value.trim()) throw new TypeError("llms.ts returned an empty llms.txt");
    return value.endsWith("\n") ? value : `${value}\n`;
  }
  if (!isRecord(value)) {
    throw new TypeError("llms.ts must return llms.txt text, an llms.txt object, or a Response");
  }
  const title = requireText(value.title, "llms.ts must return a non-empty title");
  const summary = optionalText(value.summary, "llms.ts summary must be a string");
  const details = optionalText(value.details, "llms.ts details must be a string");
  if (value.sections !== undefined && !Array.isArray(value.sections)) {
    throw new TypeError("llms.ts sections must be an array");
  }

  const blocks = [`# ${toSingleLine(title)}`];
  if (summary?.trim()) blocks.push(`> ${toSingleLine(summary)}`);
  if (details?.trim()) blocks.push(details.trim());

  for (const [sectionIndex, section] of ((value.sections as unknown[]) ?? []).entries()) {
    if (!isRecord(section)) {
      throw new TypeError(`llms.ts section ${sectionIndex} must be an object`);
    }
    const sectionTitle = requireText(
      section.title,
      `llms.ts section ${sectionIndex} must include a non-empty title`,
    );
    if (!Array.isArray(section.links)) {
      throw new TypeError(`llms.ts section "${sectionTitle}" must include a links array`);
    }

    const links = section.links.map((link, linkIndex) => {
      const where = `llms.ts section "${sectionTitle}" link ${linkIndex}`;
      if (!isRecord(link)) throw new TypeError(`${where} must be an object`);
      const linkTitle = requireText(link.title, `${where} must include a non-empty title`);
      const url = requireText(link.url, `${where} must include a non-empty url`);
      const description = optionalText(link.description, `${where} description must be a string`);
      return `- [${escapeLinkText(linkTitle)}](${escapeLinkUrl(url)})${
        description?.trim() ? `: ${toSingleLine(description)}` : ""
      }`;
    });
    blocks.push(`## ${toSingleLine(sectionTitle)}`, links.join("\n"));
  }

  return `${blocks.filter(Boolean).join("\n\n")}\n`;
}

function readMetadataTitle(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const { title } = metadata;
  if (typeof title === "string") return title.trim() || undefined;
  if (isRecord(title)) {
    for (const key of ["absolute", "default"] as const) {
      const value = title[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

function readMetadataString(metadata: unknown, key: string): string | undefined {
  if (!isRecord(metadata)) return undefined;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fallbackPageTitle(path: string): string {
  if (path === "/") return "Home";
  const segments = path.split("/").filter(Boolean);
  const segment = segments[segments.length - 1] ?? path;
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : path;
}

// Headings, quotes, and list items are single lines; newlines in a value would
// otherwise start new Markdown blocks.
function toSingleLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeLinkText(value: string): string {
  return toSingleLine(value).replace(/[\\[\]]/g, "\\$&");
}

// encodeURIComponent leaves "(" and ")" alone, and ")" would end the link early.
function escapeLinkUrl(value: string): string {
  return value
    .trim()
    .replace(
      /[\s()<>]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    );
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(message);
  return value;
}

function optionalText(value: unknown, message: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(message);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
