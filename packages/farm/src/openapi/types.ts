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
  /**
   * Leave this operation out of the generated OpenAPI document. The route is still
   * served and callable; this is not access control.
   */
  hidden?: boolean;
  /** Authentication requirement advertised for this operation. */
  security?: OpenAPISecurityMode;
  /** Known responses keyed by an HTTP status code or `default`. */
  responses?: Partial<Record<`${number}` | "default", EndpointOpenAPIResponseMetadata>>;
}

/**
 * The `openapi` export of an API route file. It applies to every method the file
 * exports, including plain `export function GET` handlers.
 */
export interface RouteOpenAPIConfig {
  /** Leave the file's operations out of the generated OpenAPI document. */
  hidden?: boolean;
}

/** An OpenAPI 3.0 Operation Object, passed through to the document as written. */
export interface OpenAPIOperationObject {
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenAPISchema[];
  requestBody?: OpenAPISchema;
  responses: Record<string, OpenAPISchema>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
  [extension: `x-${string}`]: unknown;
}

/** An OpenAPI 3.0 Path Item Object, passed through to the document as written. */
export interface OpenAPIPathItemObject {
  summary?: string;
  description?: string;
  parameters?: OpenAPISchema[];
  get?: OpenAPIOperationObject;
  put?: OpenAPIOperationObject;
  post?: OpenAPIOperationObject;
  delete?: OpenAPIOperationObject;
  options?: OpenAPIOperationObject;
  head?: OpenAPIOperationObject;
  patch?: OpenAPIOperationObject;
  trace?: OpenAPIOperationObject;
  [extension: `x-${string}`]: unknown;
}
