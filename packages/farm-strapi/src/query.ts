import type { API, StrapiClient } from "@strapi/client";
import type { GeneratedStrapiCollection, StrapiGeneratedResource } from "./schema-types.js";

export type StrapiQueryParams = API.BaseQueryParams;
export type StrapiDocument = API.Document;

export interface TypedStrapiCollection<TDocument extends StrapiDocument> {
  find(query?: StrapiQueryParams): Promise<TDocument[]>;
  findOne(documentId: string, query?: StrapiQueryParams): Promise<TDocument>;
}

function assertResourceName(resource: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(resource)) {
    throw new TypeError(
      `Strapi resource ${JSON.stringify(resource)} must be a collection API id, not a path`,
    );
  }
}

function assertDocumentId(documentId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(documentId)) {
    throw new TypeError(
      `Strapi document id ${JSON.stringify(documentId)} must be an id, not a path`,
    );
  }
}

function assertDocument(value: unknown, operation: string): asserts value is StrapiDocument {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as { documentId?: unknown }).documentId !== "string"
  ) {
    throw new TypeError(`${operation} received a response without a Strapi document`);
  }
}

/**
 * Adds an application-owned document type to the official Strapi manager and
 * unwraps the REST `data` envelope. Use the returned methods inside
 * `createServerQuery` so provider credentials remain on the server.
 */
export function createStrapiCollection<const TResource extends StrapiGeneratedResource>(
  client: StrapiClient,
  resource: TResource,
): GeneratedStrapiCollection<TResource>;
export function createStrapiCollection<TDocument extends StrapiDocument>(
  client: StrapiClient,
  resource: string,
): TypedStrapiCollection<TDocument>;
export function createStrapiCollection(
  client: StrapiClient,
  resource: string,
): TypedStrapiCollection<StrapiDocument>;
export function createStrapiCollection(
  client: StrapiClient,
  resource: string,
): TypedStrapiCollection<StrapiDocument> {
  assertResourceName(resource);
  const manager = client.collection(resource);

  return {
    async find(query) {
      const response = await manager.find(query);
      if (!response || !Array.isArray(response.data)) {
        throw new TypeError(`Strapi collection ${JSON.stringify(resource)} returned no data array`);
      }
      for (const document of response.data) {
        assertDocument(document, `Strapi collection ${JSON.stringify(resource)}`);
      }
      return response.data;
    },
    async findOne(documentId, query) {
      assertDocumentId(documentId);
      const response = await manager.findOne(documentId, query);
      assertDocument(response?.data, `Strapi collection ${JSON.stringify(resource)}`);
      return response.data;
    },
  };
}
