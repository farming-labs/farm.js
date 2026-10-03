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
  //
  // Resolve against the collection's own read query, so a write can only ever
  // address a document this collection actually reads. Two earlier shapes were
  // both wrong: an unconstrained `slug.current == $id` lookup could resolve a
  // document of an unrelated type that happened to share the slug, and
  // deleting it destroyed data the collection does not own; constraining to
  // `createType` instead left every entry of any other type in a multi-type
  // collection unresolvable, so ordinary updates started throwing.
  //
  // Resolved live on every write, because a cached mapping goes stale the
  // moment an editor reassigns a slug. That costs one query per write, which
  // is the same query the read path already runs, and writes are rare next to
  // reads.
  const resolveDocumentId = async (id: string): Promise<string> => {
    const documents = await resolveWriteClient().fetch<unknown>(
      options.query,
      options.params ?? {},
    );
    if (!Array.isArray(documents)) {
      throw new Error(
        `sanitySource(${JSON.stringify(name)}) query must resolve to an array of documents; ` +
          "the write was not sent.",
      );
    }

    const records = documents as Record<string, unknown>[];
    const match =
      records.find((record) => resolveId(record) === id) ??
      // A custom `id` option can address documents by their own `_id`.
      records.find((record) => record._id === id);
    if (!match) {
      throw new Error(
        `sanitySource(${JSON.stringify(name)}) could not resolve ${JSON.stringify(id)} to a ` +
          "document this collection reads; the write was not sent. The entry may have been " +
          "deleted, its slug may have changed, or it may belong to another collection.",
      );
    }

    const documentId = match._id;
    if (typeof documentId !== "string" || !documentId) {
      // Reads only need an id the projection can derive, so a query that omits
      // `_id` loads fine and then cannot be written back. Say which projection
      // is short rather than claiming the entry does not exist.
      throw new Error(
        `sanitySource(${JSON.stringify(name)}) resolved ${JSON.stringify(id)} to a document ` +
          "without an `_id`; the write was not sent. Add `_id` to the collection query's " +
          "projection so writes can address the document.",
      );
    }

    return documentId;
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
