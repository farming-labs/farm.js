import type { ContentRemoteDocument, ContentRemoteSource } from "@farm.js/content";
import type { SanityClient } from "@sanity/client";
import { createSanityClient } from "./client.js";
import { resolveSanityConfig } from "./config.js";

export interface SanityContentSourceOptions {
  /** GROQ query resolving to an array of documents. */
  query: string;
  params?: Record<string, unknown>;
  /** Existing Sanity client. When provided, Farm does not construct its own. */
  client?: SanityClient;
  projectId?: string;
  dataset?: string;
  apiVersion?: string;
  token?: string;
  /**
   * Defaults to false here, unlike the integration: content is fetched while
   * the configuration loads and bundled, so a build wants the freshest
   * documents rather than the CDN's cached copy.
   */
  useCdn?: boolean;
  /** Names the source in error messages. Defaults to "sanity". */
  name?: string;
  /**
   * Entry identifier per document. Defaults to `slug.current` when present,
   * falling back to `_id`.
   */
  id?: (document: Record<string, unknown>) => string;
  /** Optional Markdown body per document, for `entry.body` and word counts. */
  body?: (document: Record<string, unknown>) => string | undefined;
  /** Development re-fetch cadence in milliseconds. */
  refreshInterval?: number;
}

/**
 * A `@farm.js/content` source that loads documents from Sanity, so a CMS
 * collection gets the same schema validation, transforms, and generated
 * server types as local files. Content is a build-time snapshot; configure a
 * Sanity webhook against a deploy hook to rebuild on publish.
 */
export function sanitySource(options: SanityContentSourceOptions): ContentRemoteSource {
  if (typeof options?.query !== "string" || !options.query.trim()) {
    throw new TypeError("sanitySource() requires a GROQ `query` string");
  }

  const name = options.name ?? "sanity";
  const resolveId = options.id ?? defaultDocumentId;

  // Resolved lazily so importing farm.config.ts without the env set only
  // fails when the collection actually loads, with an actionable message.
  let client: SanityClient | undefined = options.client;
  const resolveClient = (): SanityClient => {
    if (client) return client;
    const config = resolveSanityConfig({
      projectId: options.projectId,
      dataset: options.dataset,
      apiVersion: options.apiVersion,
      token: options.token,
      useCdn: options.useCdn ?? false,
    });
    if (!config.projectId || !config.dataset) {
      throw new Error(
        `sanitySource(${JSON.stringify(name)}) requires a project id and dataset. Set ` +
          "SANITY_PROJECT_ID and SANITY_DATASET, pass them to sanitySource(), or supply " +
          "an existing client through `client`.",
      );
    }
    client = createSanityClient(config);
    return client;
  };

  return {
    kind: "remote",
    name,
    ...(options.refreshInterval !== undefined
      ? { refreshInterval: options.refreshInterval }
      : {}),
    async fetch(): Promise<readonly ContentRemoteDocument[]> {
      const result = await resolveClient().fetch(options.query, options.params ?? {});
      if (!Array.isArray(result)) {
        throw new Error(
          `sanitySource(${JSON.stringify(name)}) query must resolve to an array of documents; ` +
            "wrap single documents in [] in the GROQ projection",
        );
      }

      return result.map((document, index) => {
        if (!document || typeof document !== "object" || Array.isArray(document)) {
          throw new Error(
            `sanitySource(${JSON.stringify(name)}) document at index ${index} is not an object`,
          );
        }
        const record = document as Record<string, unknown>;
        const id = resolveId(record);
        if (typeof id !== "string" || !id) {
          throw new Error(
            `sanitySource(${JSON.stringify(name)}) could not derive an id for the document at ` +
              `index ${index}; give documents a slug or pass an \`id\` function`,
          );
        }
        const body = options.body?.(record);
        return {
          id,
          data: record,
          ...(typeof body === "string" ? { body } : {}),
        };
      });
    },
  };
}

function defaultDocumentId(document: Record<string, unknown>): string {
  const slug = document.slug;
  if (slug && typeof slug === "object" && typeof (slug as { current?: unknown }).current === "string") {
    return (slug as { current: string }).current;
  }
  return typeof document._id === "string" ? document._id : "";
}
