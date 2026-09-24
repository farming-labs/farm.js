import type { ContentRemoteDocument, ContentRemoteSource } from "@farm.js/content";
import { createClient, type ContentfulClientApi } from "contentful";

/** The slice of a Contentful entry the source reads; structural on purpose. */
interface ContentfulEntryLike {
  sys: { id: string };
  fields: Record<string, unknown>;
}

interface ContentfulQueryResult {
  items: ContentfulEntryLike[];
  total: number;
}

export interface ContentfulSourceOptions {
  /** Contentful content type ID to load, e.g. "post". */
  contentType: string;
  /**
   * Extra `getEntries` parameters: `order`, `include`, field filters. `skip`
   * and `content_type` are owned by the source; `limit` caps the page size.
   */
  query?: Record<string, unknown>;
  /** Existing Contentful client. When provided, Farm does not construct its own. */
  client?: ContentfulClientApi<undefined>;
  /** Defaults to `CONTENTFUL_SPACE_ID`. */
  space?: string;
  /** Defaults to `CONTENTFUL_ACCESS_TOKEN` (`CONTENTFUL_PREVIEW_TOKEN` for the preview host). */
  accessToken?: string;
  /** Defaults to `CONTENTFUL_ENVIRONMENT`, then "master". */
  environment?: string;
  /** Set "preview.contentful.com" with a preview token to load drafts. */
  host?: string;
  /** Names the source in error messages. Defaults to `contentful:<contentType>`. */
  name?: string;
  /**
   * Entry identifier per document. Defaults to a string `fields.slug` when
   * present, falling back to `sys.id`.
   */
  id?: (entry: { sys: { id: string }; fields: Record<string, unknown> }) => string;
  /** Optional Markdown body per document, for `entry.body` and word counts. */
  body?: (fields: Record<string, unknown>) => string | undefined;
  /** Development re-fetch cadence in milliseconds. */
  refreshInterval?: number;
}

/** Contentful caps a single page at 1000 entries. */
const PAGE_SIZE = 1000;

/**
 * A `@farm.js/content` source that loads entries from Contentful, so a CMS
 * collection gets the same schema validation, transforms, and generated
 * server types as local files. Content is a build-time snapshot; point a
 * Contentful webhook at a deploy hook to rebuild on publish.
 */
export function contentfulSource(options: ContentfulSourceOptions): ContentRemoteSource {
  if (typeof options?.contentType !== "string" || !options.contentType.trim()) {
    throw new TypeError("contentfulSource() requires a `contentType`");
  }

  const name = options.name ?? `contentful:${options.contentType}`;
  const resolveId = options.id ?? defaultEntryId;

  // Resolved lazily so importing farm.config.ts without the env set only
  // fails when the collection actually loads, with an actionable message.
  let client: ContentfulClientApi<undefined> | undefined = options.client;
  const resolveClient = (): ContentfulClientApi<undefined> => {
    if (client) return client;
    const preview = options.host?.includes("preview") ?? false;
    const space = options.space ?? process.env.CONTENTFUL_SPACE_ID;
    const accessToken =
      options.accessToken ??
      (preview ? process.env.CONTENTFUL_PREVIEW_TOKEN : undefined) ??
      process.env.CONTENTFUL_ACCESS_TOKEN;
    if (!space || !accessToken) {
      throw new Error(
        `contentfulSource(${JSON.stringify(name)}) requires a space and access token. Set ` +
          "CONTENTFUL_SPACE_ID and CONTENTFUL_ACCESS_TOKEN, pass them to contentfulSource(), " +
          "or supply an existing client through `client`.",
      );
    }
    client = createClient({
      space,
      accessToken,
      environment: options.environment ?? process.env.CONTENTFUL_ENVIRONMENT ?? "master",
      ...(options.host ? { host: options.host } : {}),
    });
    return client;
  };

  return {
    kind: "remote",
    name,
    ...(options.refreshInterval !== undefined ? { refreshInterval: options.refreshInterval } : {}),
    async fetch(): Promise<readonly ContentRemoteDocument[]> {
      const resolved = resolveClient();
      const pageSize = Math.min(Number(options.query?.limit ?? PAGE_SIZE) || PAGE_SIZE, PAGE_SIZE);
      const entries: ContentfulEntryLike[] = [];

      // getEntries pages at most 1000 entries; keep fetching until `total`.
      for (let skip = 0; ; skip += pageSize) {
        const page = (await resolved.getEntries({
          ...options.query,
          content_type: options.contentType,
          limit: pageSize,
          skip,
        })) as unknown as ContentfulQueryResult;
        if (!page || !Array.isArray(page.items)) {
          throw new Error(
            `contentfulSource(${JSON.stringify(name)}) received a response without items`,
          );
        }
        entries.push(...page.items);
        if (entries.length >= page.total || page.items.length === 0) break;
      }

      return entries.map((entry, index) => {
        if (!entry?.sys?.id || !entry.fields || typeof entry.fields !== "object") {
          throw new Error(
            `contentfulSource(${JSON.stringify(name)}) entry at index ${index} is missing sys.id or fields`,
          );
        }
        const id = resolveId(entry);
        if (typeof id !== "string" || !id) {
          throw new Error(
            `contentfulSource(${JSON.stringify(name)}) could not derive an id for entry ` +
              `${JSON.stringify(entry.sys.id)}; give entries a slug field or pass an \`id\` function`,
          );
        }
        const body = options.body?.(entry.fields);
        return {
          id,
          data: entry.fields,
          ...(typeof body === "string" ? { body } : {}),
        };
      });
    },
  };
}

function defaultEntryId(entry: { sys: { id: string }; fields: Record<string, unknown> }): string {
  const slug = entry.fields.slug;
  return typeof slug === "string" && slug ? slug : entry.sys.id;
}
