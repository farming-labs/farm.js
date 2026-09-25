export type OpenAPISecurityMode = "public" | "bearer" | "cookie" | "either";

type OpenAPISchema = Record<string, unknown>;

export type EndpointOpenAPIResponseMetadata =
  | {
      /** Human-readable description for this response. */
      description?: string;
      /** A JSON response. */
      body: "json";
      /** Override `application/json`. */
      contentType?: string;
      /** OpenAPI schema for the response body. Omit it when the shape is unknown. */
      schema?: OpenAPISchema;
    }
  | {
      /** Human-readable description for this response. */
      description?: string;
      /** A response with no body, such as 204 or an empty redirect. */
      body: "empty";
    }
  | {
      /** Human-readable description for this response. */
      description?: string;
      /** A streaming response. */
      body: "stream";
      /** Stream media type, for example `text/event-stream` or `application/x-ndjson`. */
      contentType: string;
      /** OpenAPI schema for each serialized response representation, when known. */
      schema?: OpenAPISchema;
    }
  | {
      /** Human-readable description for this response. */
      description?: string;
      /** A binary response. */
      body: "binary";
      /** Override `application/octet-stream`. */
      contentType?: string;
    };

export interface EndpointOpenAPIMetadata {
  /** Authentication requirement advertised for this operation. */
  security?: OpenAPISecurityMode;
  /** Known responses keyed by an HTTP status code or `default`. */
  responses?: Partial<Record<`${number}` | "default", EndpointOpenAPIResponseMetadata>>;
}
