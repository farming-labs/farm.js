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
  /**
   * Enables `collections.<name>.create/update/delete`. Defaults to
   * `SANITY_API_WRITE_TOKEN`; without it the source stays read-only.
   * Keep write tokens server-side only.
   */
  writeToken?: string;
  /** Sanity `_type` for documents made through `create`. Required to create. */
  createType?: string;
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

  const writeToken = options.writeToken ?? process.env.SANITY_API_WRITE_TOKEN;
  let writeClient: SanityClient | undefined;
  const resolveWriteClient = (): SanityClient => {
    if (writeClient) return writeClient;
    const base = resolveClient();
    // The write path never reads through the CDN and may need a stronger token.
    writeClient = base.withConfig({ useCdn: false, ...(writeToken ? { token: writeToken } : {}) });
    return writeClient;
  };

  // Entry ids are slugs by default, but Sanity mutations address `_id`.
  // Resolve live on every write: a cached mapping goes stale the moment an
  // editor reassigns a slug, and writes are rare enough that one lookup is
  // the right price for addressing the intended document. When `createType`
  // is configured the lookup is constrained to it, so a slug shared with an
  // unrelated document type cannot redirect the mutation.
  const resolveDocumentId = async (id: string): Promise<string> => {
    const query = options.createType
      ? "*[slug.current == $id && _type == $type][0]._id"
      : "*[slug.current == $id][0]._id";
    const bySlug = await resolveWriteClient().fetch<string | null>(query, {
      id,
      ...(options.createType ? { type: options.createType } : {}),
    });
    if (bySlug) return bySlug;
    // An id that is itself a document _id (custom `id` option) still works.
    const direct = await resolveWriteClient().fetch<string | null>("*[_id == $id][0]._id", {
      id,
    });
    if (direct) return direct;
    throw new Error(
      `sanitySource(${JSON.stringify(name)}) could not resolve ${JSON.stringify(id)} to a ` +
        "document; the write was not sent. The entry may have been deleted or its slug changed.",
    );
  };

  const toDocument = (record: Record<string, unknown>): ContentRemoteDocument => {
    const id = resolveId(record) || (record._id as string);
    const body = options.body?.(record);
    return { id, data: record, ...(typeof body === "string" ? { body } : {}) };
  };

  const writes = writeToken
    ? {
        create: async (input: { data: Record<string, unknown>; body?: string }) => {
          if (!options.createType) {
            throw new Error(
              `sanitySource(${JSON.stringify(name)}) needs \`createType\` (the Sanity _type) to create documents`,
            );
          }
          rejectUnsupportedBody(name, input.body);
          // _type is forced after the spread so request-derived data cannot
          // redirect the document into another type.
          const created = await resolveWriteClient().create({
            ...input.data,
            _type: options.createType,
          });
          return toDocument(created as unknown as Record<string, unknown>);
        },
        update: async (id: string, patch: { data?: Record<string, unknown>; body?: string }) => {
          rejectUnsupportedBody(name, patch.body);
          const documentId = await resolveDocumentId(id);
          const updated = await resolveWriteClient()
            .patch(documentId)
            .set(patch.data ?? {})
            .commit();
          return toDocument(updated as unknown as Record<string, unknown>);
        },
        delete: async (id: string) => {
          await resolveWriteClient().delete(await resolveDocumentId(id));
        },
      }
    : {};

  return {
    kind: "remote",
    name,
    ...(options.refreshInterval !== undefined ? { refreshInterval: options.refreshInterval } : {}),
    ...writes,
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

function rejectUnsupportedBody(name: string, body: string | undefined): void {
  if (typeof body !== "string") return;
  throw new Error(
    `sanitySource(${JSON.stringify(name)}) does not store \`body\`: Sanity documents keep ` +
      "content in fields. Put the text in `data` under the field your schema expects.",
  );
}

function defaultDocumentId(document: Record<string, unknown>): string {
  const slug = document.slug;
  if (
    slug &&
    typeof slug === "object" &&
    typeof (slug as { current?: unknown }).current === "string"
  ) {
    return (slug as { current: string }).current;
  }
  return typeof document._id === "string" ? document._id : "";
}
