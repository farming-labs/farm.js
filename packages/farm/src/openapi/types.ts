export type OpenAPISecurityMode = "public" | "bearer" | "cookie" | "either";

export interface EndpointOpenAPIMetadata {
  /** Authentication requirement advertised for this operation. */
  security?: OpenAPISecurityMode;
}
