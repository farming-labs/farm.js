import type { Metadata } from "./types";

export type MetadataImageKind = "opengraph" | "twitter";

export interface FarmMetadataImageReference {
  kind: MetadataImageKind;
  href: string;
  alt?: string;
  width?: number;
  height?: number;
  contentType?: string;
}

export interface RenderedMetadataHead {
  title: string;
  tags: string;
  hasFavicon: boolean;
  /** False when the title is the framework fallback rather than configured. */
  hasExplicitTitle: boolean;
}

type MetadataRecord = Metadata & Record<string, any>;

export function mergeMetadata(
  base: MetadataRecord | undefined,
  next: MetadataRecord | undefined,
): MetadataRecord {
  if (!base) return next ? { ...next } : {};
  if (!next) return { ...base };

  return {
    ...base,
    ...next,
    openGraph: mergeNestedMetadata(base.openGraph, next.openGraph),
    twitter: mergeNestedMetadata(base.twitter, next.twitter),
    alternates: mergeNestedMetadata((base as any).alternates, (next as any).alternates),
    icons: mergeNestedMetadata((base as any).icons, (next as any).icons),
  };
}

export function addMetadataImageReference(
  metadata: MetadataRecord,
  reference: FarmMetadataImageReference,
): MetadataRecord {
  if (reference.kind === "opengraph") {
    const openGraph = { ...metadata.openGraph };
    if (!hasMetadataImages(openGraph.images) && !hasMetadataImages((openGraph as any).image)) {
      openGraph.images = [
        {
          url: reference.href,
          width: reference.width,
          height: reference.height,
          alt: reference.alt,
          type: reference.contentType,
        },
      ];
    }

    return {
      ...metadata,
      openGraph,
    };
  }

  const twitter = { ...metadata.twitter };
  if (!hasMetadataImages(twitter.images)) {
    twitter.images = [reference.href];
    twitter.card = twitter.card || "summary_large_image";
  }

  return {
    ...metadata,
    twitter,
  };
}

export function renderMetadataHead(metadata: MetadataRecord | undefined): RenderedMetadataHead {
  const resolvedMetadata = metadata || {};
  const metadataBase = resolveMetadataBase(resolvedMetadata);
  const explicitTitle = resolveMetadataTitle(resolvedMetadata.title);
  const title = explicitTitle || "Farm.js App";
  const tags: string[] = [];

  appendMetaName(tags, "description", resolvedMetadata.description);
  appendMetaName(tags, "keywords", normalizeKeywords(resolvedMetadata.keywords));
  appendMetaName(tags, "author", (resolvedMetadata as any).author);

  if (Array.isArray(resolvedMetadata.authors)) {
    for (const author of resolvedMetadata.authors) {
      appendMetaName(tags, "author", author?.name);
      if (author?.url) {
        appendLink(tags, "author", resolveMetadataUrl(author.url, metadataBase));
      }
    }
  }

  appendMetaName(tags, "creator", resolvedMetadata.creator);
  appendMetaName(tags, "publisher", resolvedMetadata.publisher);
  appendMetaName(tags, "robots", normalizeRobots(resolvedMetadata.robots));

  const alternates = (resolvedMetadata as any).alternates;
  if (isRecord(alternates)) {
    appendLink(tags, "canonical", resolveMetadataUrl(alternates.canonical, metadataBase));

    if (isRecord(alternates.languages)) {
      for (const [language, href] of Object.entries(alternates.languages)) {
        appendLink(tags, "alternate", resolveMetadataUrl(href, metadataBase), {
          hreflang: language,
        });
      }
    }
  }

  const hasFavicon = appendIcons(tags, (resolvedMetadata as any).icons, metadataBase);

  if ((resolvedMetadata as any).manifest) {
    appendLink(
      tags,
      "manifest",
      resolveMetadataUrl((resolvedMetadata as any).manifest, metadataBase),
    );
  }

  appendOpenGraph(tags, resolvedMetadata.openGraph, metadataBase);
  appendTwitter(tags, resolvedMetadata.twitter, metadataBase);

  return {
    title: escapeText(title),
    tags: tags.length > 0 ? `\n  ${tags.join("\n  ")}` : "",
    hasFavicon,
    hasExplicitTitle: Boolean(explicitTitle),
  };
}

function mergeNestedMetadata(base: unknown, next: unknown): any {
  if (isRecord(base) && isRecord(next)) {
    return {
      ...base,
      ...next,
    };
  }

  return next ?? base;
}

function appendOpenGraph(tags: string[], openGraph: Metadata["openGraph"], metadataBase?: string) {
  if (!isRecord(openGraph)) return;

  appendMetaProperty(tags, "og:title", openGraph.title);
  appendMetaProperty(tags, "og:description", openGraph.description);
  appendMetaProperty(tags, "og:url", resolveMetadataUrl(openGraph.url, metadataBase));
  appendMetaProperty(tags, "og:site_name", openGraph.siteName);
  appendMetaProperty(tags, "og:type", openGraph.type);
  appendMetaProperty(tags, "og:locale", (openGraph as any).locale);

  const images = normalizeMetadataImages(
    openGraph.images ?? (openGraph as any).image,
    metadataBase,
  );
  for (const image of images) {
    appendMetaProperty(tags, "og:image", image.url);
    appendMetaProperty(tags, "og:image:width", image.width);
    appendMetaProperty(tags, "og:image:height", image.height);
    appendMetaProperty(tags, "og:image:alt", image.alt);
    appendMetaProperty(tags, "og:image:type", image.type);
  }
}

function appendTwitter(tags: string[], twitter: Metadata["twitter"], metadataBase?: string) {
  if (!isRecord(twitter)) return;

  appendMetaName(tags, "twitter:card", twitter.card);
  appendMetaName(tags, "twitter:site", twitter.site);
  appendMetaName(tags, "twitter:creator", twitter.creator);
  appendMetaName(tags, "twitter:title", twitter.title);
  appendMetaName(tags, "twitter:description", twitter.description);

  for (const image of normalizeMetadataImages(twitter.images, metadataBase)) {
    appendMetaName(tags, "twitter:image", image.url);
    appendMetaName(tags, "twitter:image:alt", image.alt);
  }
}

function appendIcons(tags: string[], icons: unknown, metadataBase?: string): boolean {
  if (!icons) return false;

  if (typeof icons === "string") {
    const initialTagCount = tags.length;
    appendLink(tags, "icon", resolveMetadataUrl(icons, metadataBase));
    return tags.length > initialTagCount;
  }

  if (!isRecord(icons)) return false;

  const initialTagCount = tags.length;
  appendIconList(tags, "icon", icons.icon, metadataBase);
  appendIconList(tags, "shortcut icon", icons.shortcut, metadataBase);
  const hasFavicon = tags.length > initialTagCount;
  appendIconList(tags, "apple-touch-icon", icons.apple, metadataBase);
  return hasFavicon;
}

function appendIconList(tags: string[], rel: string, value: unknown, metadataBase?: string) {
  for (const icon of normalizeArray(value)) {
    if (typeof icon === "string") {
      appendLink(tags, rel, resolveMetadataUrl(icon, metadataBase));
      continue;
    }

    if (!isRecord(icon)) continue;
    appendLink(tags, rel, resolveMetadataUrl(icon.url, metadataBase), {
      sizes: icon.sizes,
      type: icon.type,
    });
  }
}

function appendMetaName(tags: string[], name: string, content: unknown) {
  const normalized = normalizeContent(content);
  if (!normalized) return;
  tags.push(`<meta name="${escapeAttribute(name)}" content="${escapeAttribute(normalized)}">`);
}

function appendMetaProperty(tags: string[], property: string, content: unknown) {
  const normalized = normalizeContent(content);
  if (!normalized) return;
  tags.push(
    `<meta property="${escapeAttribute(property)}" content="${escapeAttribute(normalized)}">`,
  );
}

function appendLink(
  tags: string[],
  rel: string,
  href: unknown,
  attrs: Record<string, unknown> = {},
) {
  const normalizedHref = normalizeContent(href);
  if (!normalizedHref) return;

  const attrText = Object.entries(attrs)
    .map(([key, value]) => {
      const normalized = normalizeContent(value);
      return normalized ? ` ${key}="${escapeAttribute(normalized)}"` : "";
    })
    .join("");

  tags.push(
    `<link rel="${escapeAttribute(rel)}" href="${escapeAttribute(normalizedHref)}"${attrText}>`,
  );
}

function normalizeMetadataImages(
  value: unknown,
  metadataBase?: string,
): Array<{
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  type?: string;
}> {
  return normalizeArray(value)
    .map((item) => {
      if (typeof item === "string") {
        return { url: resolveMetadataUrl(item, metadataBase) || item };
      }

      if (!isRecord(item)) return null;
      const rawUrl = item.url || item.src;
      const url = resolveMetadataUrl(rawUrl, metadataBase);
      if (!url) return null;

      return {
        url,
        width: normalizeNumber(item.width),
        height: normalizeNumber(item.height),
        alt: typeof item.alt === "string" ? item.alt : undefined,
        type: typeof item.type === "string" ? item.type : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

function normalizeArray(value: unknown): unknown[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function hasMetadataImages(value: unknown): boolean {
  return normalizeMetadataImages(value).length > 0;
}

function resolveMetadataTitle(title: Metadata["title"]): string | undefined {
  if (typeof title === "string") return title;
  if (isRecord(title)) {
    return normalizeContent(title.default);
  }
  return undefined;
}

function normalizeKeywords(keywords: Metadata["keywords"]): string | undefined {
  if (Array.isArray(keywords)) return keywords.filter(Boolean).join(", ");
  return keywords;
}

function normalizeRobots(robots: Metadata["robots"]): string | undefined {
  if (typeof robots === "string") return robots;
  if (!isRecord(robots)) return undefined;

  const values: string[] = [];
  if (typeof robots.index === "boolean") values.push(robots.index ? "index" : "noindex");
  if (typeof robots.follow === "boolean") values.push(robots.follow ? "follow" : "nofollow");
  return values.join(", ") || undefined;
}

function resolveMetadataBase(metadata: MetadataRecord): string | undefined {
  const base = metadata.metadataBase;
  if (!base) return undefined;
  return String(base);
}

function resolveMetadataUrl(value: unknown, metadataBase?: string): string | undefined {
  const normalized = normalizeContent(value);
  if (!normalized) return undefined;
  if (!metadataBase) return normalized;

  try {
    return new URL(normalized, metadataBase).toString();
  } catch {
    return normalized;
  }
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeContent(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof URL) return value.toString();
  return undefined;
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
