import type { OpenAPIConfig } from "../config";
import type { APIRouteInfo } from "../type-generator";
import type {
  EndpointOpenAPIMetadata,
  EndpointOpenAPIResponseMetadata,
  OpenAPISecurityMode,
} from "./types";

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    description?: string;
    version: string;
    contact?: {
      name?: string;
      email?: string;
      url?: string;
    };
    license?: {
      name: string;
      url?: string;
    };
  };
  servers?: Array<{
    url: string;
    description?: string;
  }>;
  paths: Record<string, any>;
  components?: {
    schemas?: Record<string, any>;
    securitySchemes?: Record<string, any>;
  };
}

type AllowedType = "string" | "number" | "boolean" | "array" | "object";
const allowedType = new Set(["string", "number", "boolean", "array", "object"]);
const zodTypeNameKinds: Record<string, string> = {
  ZodArray: "array",
  ZodBoolean: "boolean",
  ZodDefault: "default",
  ZodEnum: "enum",
  ZodLiteral: "literal",
  ZodNullable: "nullable",
  ZodNumber: "number",
  ZodObject: "object",
  ZodOptional: "optional",
  ZodRecord: "record",
  ZodString: "string",
  ZodTuple: "tuple",
  ZodUnion: "union",
};

function getZodKind(schema: unknown): string | undefined {
  if (!schema || typeof schema !== "object") return undefined;
  const definition = (schema as any)._def;
  if (!definition || typeof definition !== "object") return undefined;
  if (typeof definition.type === "string") return definition.type;
  return typeof definition.typeName === "string"
    ? zodTypeNameKinds[definition.typeName]
    : undefined;
}

function getZodObjectShape(schema: unknown): Record<string, unknown> | undefined {
  if (getZodKind(schema) !== "object") return undefined;
  const candidate = (schema as any).shape ?? (schema as any)._def?.shape;
  const shape = typeof candidate === "function" ? candidate() : candidate;
  return shape && typeof shape === "object" ? shape : undefined;
}

function isStandardSchema(schema: unknown): boolean {
  return (
    !!schema &&
    typeof schema === "object" &&
    typeof (schema as any)["~standard"]?.validate === "function"
  );
}

/**
 * OpenAPI `type` for a literal's value(s). A single-type literal keeps its JS
 * type; mixed-type literal sets fall back to string (the enum still carries the
 * exact values). bigint maps to integer.
 */
function openAPITypeForLiteralValues(values: readonly unknown[]): AllowedType {
  if (values.length === 0) return "string";
  const jsType = typeof values[0];
  if (!values.every((value) => typeof value === jsType)) return "string";
  switch (jsType) {
    case "number":
      return "number";
    case "bigint":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "string";
  }
}

export class OpenAPIGenerator {
  private config: OpenAPIConfig;
  private appDir: string;

  constructor(appDir: string, config: OpenAPIConfig) {
    this.appDir = appDir;
    this.config = config;
  }

  /**
   * Get type from Zod type
   */
  private getTypeFromZodType(zodType: unknown): AllowedType {
    const tag = getZodKind(zodType);
    return typeof tag === "string" && allowedType.has(tag) ? (tag as AllowedType) : "string";
  }

  /**
   * Whether a schema field must be supplied by the caller. A field with a
   * default is supplied by the server when omitted, so — like an explicitly
   * optional field — it is not required. Only ZodOptional was excluded before,
   * which documented every `.default()` field as required.
   */
  private isRequiredField(value: unknown): boolean {
    const kind = getZodKind(value);
    return kind !== "optional" && kind !== "default";
  }

  /**
   * Process Zod type to OpenAPI schema
   */
  private processZodType(zodType: unknown): any {
    const kind = getZodKind(zodType);
    const definition = (zodType as any)?._def;

    if (!kind) {
      return isStandardSchema(zodType)
        ? { description: "Schema metadata is unavailable for this Standard Schema validator." }
        : { description: "Schema metadata is unavailable." };
    }

    // Handle ZodOptional and ZodNullable
    if (kind === "optional" || kind === "nullable") {
      const innerType = definition.innerType;
      const innerSchema = this.processZodType(innerType);
      return {
        ...innerSchema,
        nullable: true,
      };
    }

    // Handle ZodDefault. The value is always present after parsing, so the
    // documented type is the wrapped one.
    if (kind === "default") {
      return this.processZodType(definition.innerType);
    }

    // Handle ZodObject
    if (kind === "object") {
      const shape = getZodObjectShape(zodType);
      if (shape) {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        Object.entries(shape).forEach(([key, value]) => {
          if (getZodKind(value) || isStandardSchema(value)) {
            properties[key] = this.processZodType(value);
            if (this.isRequiredField(value)) {
              required.push(key);
            }
          }
        });
        return {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
          description: (zodType as any).description,
        };
      }
    }

    // Handle ZodArray
    if (kind === "array") {
      return {
        type: "array",
        items: this.processZodType(
          definition.element ?? (typeof definition.type === "object" ? definition.type : undefined),
        ),
        description: (zodType as any).description,
      };
    }

    // Handle ZodEnum
    if (kind === "enum") {
      const options =
        (zodType as any).options ??
        (definition.entries ? Object.values(definition.entries) : definition.values);
      return {
        type: "string",
        enum: options,
        description: (zodType as any).description,
      };
    }

    // Handle ZodLiteral: emit the concrete value(s) as an enum rather than
    // dropping the constraint and documenting a bare string.
    if (kind === "literal") {
      const values =
        (definition.values as unknown[]) ??
        (Object.prototype.hasOwnProperty.call(definition, "value") ? [definition.value] : []);
      return {
        type: openAPITypeForLiteralValues(values),
        ...(values.length > 0 ? { enum: [...values] } : {}),
        description: (zodType as any).description,
      };
    }

    // Handle ZodUnion (including discriminated unions): oneOf over the members.
    if (kind === "union") {
      const options = (definition.options as unknown[]) ?? [];
      return {
        oneOf: options.map((option) => this.processZodType(option)),
        description: (zodType as any).description,
      };
    }

    // Handle ZodRecord: an object whose values share a schema.
    if (kind === "record") {
      return {
        type: "object",
        additionalProperties: this.processZodType(definition.valueType),
        description: (zodType as any).description,
      };
    }

    // Handle ZodTuple: a fixed-length (unless variadic) array. OpenAPI 3.0 has no
    // positional items, so the element schemas are unioned; the length is pinned
    // when there is no rest element.
    if (kind === "tuple") {
      const items = (definition.items as unknown[]) ?? [];
      const rest = definition.rest;
      const itemSchemas = items.map((item) => this.processZodType(item));
      const tupleSchema: any = {
        type: "array",
        items: itemSchemas.length === 1 ? itemSchemas[0] : { oneOf: itemSchemas },
        description: (zodType as any).description,
      };
      if (!rest) {
        tupleSchema.minItems = items.length;
        tupleSchema.maxItems = items.length;
      }
      return tupleSchema;
    }

    // For primitive types
    const baseSchema: any = {
      type: this.getTypeFromZodType(zodType),
      description: (zodType as any).description,
    };

    // Add constraints if available. `min`/`max` are methods rather than values, so
    // the bounds are read from `minValue`/`maxValue`. An absent bound is reported as
    // `null` or as an infinity depending on the schema, and neither belongs in the
    // document; a finite check keeps a `0` bound and drops both.
    const constraints: Array<[string, unknown]> = [
      ["minLength", (zodType as any).minLength],
      ["maxLength", (zodType as any).maxLength],
      ["minimum", (zodType as any).minValue],
      ["maximum", (zodType as any).maxValue],
    ];
    for (const check of definition.checks ?? []) {
      if (check?.kind === "min") {
        constraints.push([kind === "string" ? "minLength" : "minimum", check.value]);
      } else if (check?.kind === "max") {
        constraints.push([kind === "string" ? "maxLength" : "maximum", check.value]);
      }
    }
    for (const [key, value] of constraints) {
      // Zod 4's .int() implies bounds of +/-Number.MAX_SAFE_INTEGER; those are
      // implementation details of the safe-integer range, not author-declared
      // constraints, and would otherwise stamp every integer field with
      // maximum: 9007199254740991.
      if (Number.isFinite(value) && Math.abs(value as number) !== Number.MAX_SAFE_INTEGER) {
        baseSchema[key] = value;
      }
    }

    return baseSchema;
  }

  private getResponses(metadata: EndpointOpenAPIMetadata): Record<string, any> {
    const responses = Object.entries(metadata.responses ?? {}).filter(
      (entry): entry is [string, EndpointOpenAPIResponseMetadata] => entry[1] !== undefined,
    );
    if (responses.length === 0) {
      return {
        default: {
          description: "Response metadata is unavailable.",
        },
      };
    }

    return Object.fromEntries(
      responses.map(([status, response]) => [status, this.getResponse(response)]),
    );
  }

  private getResponse(response: EndpointOpenAPIResponseMetadata): Record<string, any> {
    if (response.body === "empty") {
      return {
        description: response.description ?? "Empty response",
      };
    }

    if (response.body === "binary") {
      return {
        description: response.description ?? "Binary response",
        content: {
          [response.contentType ?? "application/octet-stream"]: {
            schema: { type: "string", format: "binary" },
          },
        },
      };
    }

    const contentType =
      response.body === "json"
        ? (response.contentType ?? "application/json")
        : response.contentType;
    return {
      description:
        response.description ?? (response.body === "json" ? "JSON response" : "Streaming response"),
      content: {
        [contentType]: response.schema ? { schema: response.schema } : {},
      },
    };
  }

  /**
   * Generate OpenAPI spec from API routes
   */
  async generateSpec(routes: APIRouteInfo[]): Promise<OpenAPISpec> {
    const spec: OpenAPISpec = {
      openapi: "3.0.3",
      info: {
        title: this.config.title || "API Documentation",
        description: this.config.description || "Auto-generated API documentation",
        version: this.config.version || "1.0.0",
        ...(this.config.contact && { contact: this.config.contact }),
        ...(this.config.license && { license: this.config.license }),
      },
      servers: this.config.servers || [
        { url: "http://localhost:3000", description: "Development server" },
      ],
      paths: {},
      components: {
        schemas: {},
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            description: "Bearer token authentication",
          },
          apiKeyCookie: {
            type: "apiKey",
            in: "cookie",
            name: "session",
            description: "API Key authentication via cookie",
          },
        },
      },
    };

    // Group routes by path
    const routeGroups = new Map<string, APIRouteInfo[]>();
    for (const route of routes) {
      const key = route.path;
      if (!routeGroups.has(key)) {
        routeGroups.set(key, []);
      }
      routeGroups.get(key)!.push(route);
    }

    // Generate paths
    for (const [path, routeList] of routeGroups) {
      const openAPIPath = this.convertToOpenAPIPath(path);
      spec.paths[openAPIPath] = {};

      for (const route of routeList) {
        for (const method of route.methods) {
          const operation = await this.generateOperation(route, method);
          if (method === "QUERY") {
            const additionalOperations =
              spec.paths[openAPIPath]["x-oai-additionalOperations"] ?? {};
            additionalOperations.QUERY = operation;
            spec.paths[openAPIPath]["x-oai-additionalOperations"] = additionalOperations;
          } else {
            spec.paths[openAPIPath][method.toLowerCase()] = operation;
          }
        }
      }
    }

    return spec;
  }

  /**
   * Convert a Farm.js API path to OpenAPI path format.
   *
   * Strips the `/api` prefix and rewrites dynamic segments to OpenAPI's
   * `{name}` templating: `[id]` -> `{id}`, `[...slug]` -> `{slug}`, and
   * `[[...slug]]` -> `{slug}`. Leaving the bracket form produces a path key that
   * is invalid OpenAPI, which breaks "try it" and any generated client.
   */
  private convertToOpenAPIPath(path: string): string {
    return path
      .replace(/^\/api/, "")
      .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "{$1}")
      .replace(/\[\.\.\.([^\]]+)\]/g, "{$1}")
      .replace(/\[([^\]]+)\]/g, "{$1}");
  }

  /**
   * Path parameters implied by a Farm.js API path's dynamic segments. Every
   * path parameter is `required: true` per the OpenAPI spec (a path parameter
   * cannot be optional), including catch-all segments.
   */
  private getPathParameters(path: string): any[] {
    const openAPIPath = this.convertToOpenAPIPath(path);
    return [...openAPIPath.matchAll(/\{([^}]+)\}/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
  }

  /**
   * Extract request body schema from endpoint
   */
  private async getRequestBody(route: APIRouteInfo, method: string): Promise<any> {
    if (!["QUERY", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      return undefined;
    }

    try {
      // Try to dynamically load the route module
      const modulePath = route.filePath;
      const routeModule = await import(/* @vite-ignore */ modulePath);

      // Get the method handler (GET, POST, etc.)
      const handler = routeModule[method];

      const bodySchema = handler?.__types?.body ?? handler?._type?.body;
      if (bodySchema) {
        return {
          required: this.isRequiredField(bodySchema),
          content: {
            "application/json": {
              schema: this.processZodType(bodySchema),
            },
          },
        };
      }
    } catch (error) {
      // If we can't load the module, return generic schema
      console.warn(`Could not extract schema from ${route.filePath}:`, error);
    }

    // Fallback to generic schema
    return {
      required: true,
      content: {
        "application/json": {
          schema: {
            type: "object",
            description: "Request body",
          },
        },
      },
    };
  }

  /**
   * Extract query parameters from endpoint
   */
  private async getParameters(route: APIRouteInfo, method: string): Promise<any[]> {
    const parameters: any[] = [];

    try {
      // Try to dynamically load the route module
      const modulePath = route.filePath;
      const routeModule = await import(/* @vite-ignore */ modulePath);

      // Get the method handler
      const handler = routeModule[method];

      const querySchema = handler?.__types?.query ?? handler?._type?.query;
      const shape = getZodObjectShape(querySchema);
      if (shape) {
        Object.entries(shape).forEach(([key, value]) => {
          if (getZodKind(value) || isStandardSchema(value)) {
            parameters.push({
              name: key,
              in: "query",
              required: this.isRequiredField(value),
              schema: this.processZodType(value),
            });
          }
        });
      }
    } catch (error) {
      console.warn(`Could not extract query params from ${route.filePath}:`, error);
    }

    return parameters;
  }

  /**
   * Generate OpenAPI operation from route info
   */
  private async generateOperation(route: APIRouteInfo, method: string): Promise<any> {
    const metadata = await this.getEndpointOpenAPIMetadata(route, method);
    const security = this.getSecurityRequirements(
      metadata.security ?? this.config.security ?? "public",
    );
    const operation: any = {
      summary: this.generateSummary(route.path, method),
      description: this.generateDescription(route.path, method),
      operationId: this.generateOperationId(route.path, method),
      tags: this.generateTags(route.path),
      ...(security ? { security } : {}),
      responses: this.getResponses(metadata),
    };

    // Path parameters (from dynamic route segments) precede query parameters.
    const parameters = [
      ...this.getPathParameters(route.path),
      ...(await this.getParameters(route, method)),
    ];
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // QUERY and mutation methods can carry typed request content.
    if (["QUERY", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      operation.requestBody = await this.getRequestBody(route, method);
    }

    return operation;
  }

  private async getEndpointOpenAPIMetadata(
    route: APIRouteInfo,
    method: string,
  ): Promise<EndpointOpenAPIMetadata> {
    try {
      const routeModule = await import(/* @vite-ignore */ route.filePath);
      return routeModule[method]?.__openapi ?? {};
    } catch {
      return {};
    }
  }

  private getSecurityRequirements(mode: OpenAPISecurityMode): any[] | undefined {
    if (mode === "public") return undefined;
    if (mode === "bearer") return [{ bearerAuth: [] }];
    if (mode === "cookie") return [{ apiKeyCookie: [] }];
    return [{ bearerAuth: [] }, { apiKeyCookie: [] }];
  }

  /**
   * Generate operation summary
   */
  private generateSummary(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, "");
    const pathParts = cleanPath.split("/");
    const lastPart = pathParts[pathParts.length - 1];

    const action =
      method === "GET"
        ? "Get"
        : method === "QUERY"
          ? "Query"
          : method === "POST"
            ? "Create"
            : method === "PUT"
              ? "Update"
              : method === "DELETE"
                ? "Delete"
                : method === "PATCH"
                  ? "Update"
                  : method;

    return `${action} ${lastPart}`;
  }

  /**
   * Generate operation description
   */
  private generateDescription(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, "");
    return `${method} ${cleanPath} endpoint`;
  }

  /**
   * Generate operation ID
   */
  private generateOperationId(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, "").replace(/\//g, "_");
    return `${method.toLowerCase()}_${cleanPath}`;
  }

  /**
   * Generate tags for grouping operations
   */
  private generateTags(path: string): string[] {
    const cleanPath = path.replace(/^\/api\//, "");
    const pathParts = cleanPath.split("/");

    if (pathParts.length > 1) {
      return [pathParts[0]]; // Use first part as tag
    }

    return ["default"];
  }

  /**
   * Generate OpenAPI spec file
   */
  async generateSpecFile(routes: APIRouteInfo[], outputPath: string): Promise<void> {
    const spec = await this.generateSpec(routes);
    const fs = require("fs");
    const path = require("path");

    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write spec file
    fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  }
}
