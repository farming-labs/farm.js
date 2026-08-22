import type { OpenAPIConfig } from "../config";
import type { APIRouteInfo } from "../type-generator";
import * as z from "zod";

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
  private getTypeFromZodType(zodType: z.ZodType<any>): AllowedType {
    const def = (zodType as any)._def;
    // Zod 4 stores a lowercase name on `_def.type`; Zod 3 stored `_def.typeName`.
    // In Zod 3 `_def.type` can also be the element schema of an array, so only
    // trust it when it is a string.
    const v4Type = typeof def?.type === "string" ? def.type : undefined;
    if (v4Type && allowedType.has(v4Type)) {
      return v4Type as AllowedType;
    }
    const typeName = def?.typeName;
    if (typeName) {
      if (typeName === "ZodString") return "string";
      if (typeName === "ZodNumber") return "number";
      if (typeName === "ZodBoolean") return "boolean";
      if (typeName === "ZodArray") return "array";
      if (typeName === "ZodObject") return "object";
    }
    return "string";
  }

  /**
   * Process Zod type to OpenAPI schema
   */
  private processZodType(zodType: z.ZodType<any>): any {
    // Handle ZodOptional
    if (zodType instanceof z.ZodOptional) {
      const innerType = (zodType as any)._def.innerType;
      const innerSchema = this.processZodType(innerType);
      return {
        ...innerSchema,
        nullable: true,
      };
    }

    // Handle ZodObject
    if (zodType instanceof z.ZodObject) {
      const shape = (zodType as any).shape;
      if (shape) {
        const properties: Record<string, any> = {};
        const required: string[] = [];
        Object.entries(shape).forEach(([key, value]) => {
          if (value instanceof z.ZodType) {
            properties[key] = this.processZodType(value as z.ZodType<any>);
            if (!(value instanceof z.ZodOptional)) {
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

    // Handle ZodDefault
    if (zodType instanceof z.ZodDefault) {
      const def = (zodType as any)._def;
      const innerSchema = this.processZodType(def.innerType);
      // Zod 3 stores a thunk, Zod 4 stores the value itself.
      const defaultValue =
        typeof def.defaultValue === "function" ? def.defaultValue() : def.defaultValue;
      return {
        ...innerSchema,
        default: defaultValue,
      };
    }

    // Handle ZodArray
    if (zodType instanceof z.ZodArray) {
      const def = (zodType as any)._def;
      // Zod 4 stores the element schema on `_def.element`; Zod 3 stored it on `_def.type`.
      const itemType = def.element ?? def.type;
      return {
        type: "array",
        items: this.processZodType(itemType),
        description: (zodType as any).description,
      };
    }

    // Handle ZodEnum
    if (zodType instanceof z.ZodEnum) {
      return {
        type: "string",
        // `.options` is public in both majors; `_def.values` only existed in Zod 3.
        enum: (zodType as any).options ?? (zodType as any)._def.values,
        description: (zodType as any).description,
      };
    }

    // For primitive types
    const baseSchema: any = {
      type: this.getTypeFromZodType(zodType),
      description: (zodType as any).description,
    };

    // Add constraints if available. `.minLength`/`.maxLength` and
    // `.minValue`/`.maxValue` hold the values in both Zod majors, while
    // `.min`/`.max` are the builder methods.
    if (baseSchema.type === "string") {
      const { minLength, maxLength } = zodType as any;
      if (typeof minLength === "number") {
        baseSchema.minLength = minLength;
      }
      if (typeof maxLength === "number") {
        baseSchema.maxLength = maxLength;
      }
    } else if (baseSchema.type === "number") {
      const { minValue, maxValue } = zodType as any;
      // Zod 4's `.int()` bounds numbers to ±MAX_SAFE_INTEGER; skip those
      // implicit bounds so only user-provided constraints are documented.
      if (
        typeof minValue === "number" &&
        Number.isFinite(minValue) &&
        minValue !== Number.MIN_SAFE_INTEGER
      ) {
        baseSchema.minimum = minValue;
      }
      if (
        typeof maxValue === "number" &&
        Number.isFinite(maxValue) &&
        maxValue !== Number.MAX_SAFE_INTEGER
      ) {
        baseSchema.maximum = maxValue;
      }
    }

    return baseSchema;
  }

  /**
   * Generate standard error responses
   */
  private getStandardResponses(): Record<string, any> {
    return {
      "200": {
        description: "Successful response",
        content: {
          "application/json": {
            schema: {
              type: "object",
              description: "Response data",
            },
          },
        },
      },
      "400": {
        description: "Bad Request. Usually due to missing parameters, or invalid parameters.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
                error: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
      },
      "401": {
        description: "Unauthorized. Due to missing or invalid authentication.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
              required: ["message"],
            },
          },
        },
      },
      "403": {
        description:
          "Forbidden. You do not have permission to access this resource or to perform this action.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
            },
          },
        },
      },
      "404": {
        description: "Not Found. The requested resource was not found.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
            },
          },
        },
      },
      "429": {
        description: "Too Many Requests. You have exceeded the rate limit. Try again later.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
              },
            },
          },
        },
      },
      "500": {
        description:
          "Internal Server Error. This is a problem with the server that you cannot fix.",
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                message: { type: "string" },
                error: { type: "string" },
              },
            },
          },
        },
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
   * Convert Farm.js API path to OpenAPI path format
   */
  private convertToOpenAPIPath(path: string): string {
    // Convert /api/auth/login to /auth/login
    return path.replace(/^\/api/, "");
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

      // Check for Farm.js endpoint format: handler.__types.body
      if (handler && handler.__types && handler.__types.body) {
        const bodySchema = handler.__types.body;

        if (bodySchema instanceof z.ZodObject || bodySchema instanceof z.ZodOptional) {
          const shape = (bodySchema as any).shape || (bodySchema as any)._def?.innerType?.shape;
          if (shape) {
            const properties: Record<string, any> = {};
            const required: string[] = [];

            Object.entries(shape).forEach(([key, value]) => {
              if (value instanceof z.ZodType) {
                properties[key] = this.processZodType(value as z.ZodType<any>);
                if (!(value instanceof z.ZodOptional)) {
                  required.push(key);
                }
              }
            });
            return {
              required: bodySchema instanceof z.ZodOptional ? false : true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties,
                    ...(required.length > 0 ? { required } : {}),
                  },
                },
              },
            };
          }
        }
      }

      // Fallback: Check for better-call format: handler._type.body
      if (handler && handler._type && handler._type.body) {
        const bodySchema = handler._type.body;

        if (bodySchema instanceof z.ZodObject || bodySchema instanceof z.ZodOptional) {
          const shape = (bodySchema as any).shape || (bodySchema as any)._def?.innerType?.shape;
          if (shape) {
            const properties: Record<string, any> = {};
            const required: string[] = [];

            Object.entries(shape).forEach(([key, value]) => {
              if (value instanceof z.ZodType) {
                properties[key] = this.processZodType(value as z.ZodType<any>);
                if (!(value instanceof z.ZodOptional)) {
                  required.push(key);
                }
              }
            });

            return {
              required: bodySchema instanceof z.ZodOptional ? false : true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties,
                    ...(required.length > 0 ? { required } : {}),
                  },
                },
              },
            };
          }
        }
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

      // Check for Farm.js endpoint format: handler.__types.query
      if (handler && handler.__types && handler.__types.query) {
        const querySchema = handler.__types.query;

        if (querySchema instanceof z.ZodObject) {
          Object.entries((querySchema as any).shape).forEach(([key, value]) => {
            if (value instanceof z.ZodType) {
              parameters.push({
                name: key,
                in: "query",
                required: !(value instanceof z.ZodOptional),
                schema: this.processZodType(value as z.ZodType<any>),
              });
            }
          });
        }
      }

      // Fallback: Check for better-call format: handler._type.query
      if (handler && handler._type && handler._type.query) {
        const querySchema = handler._type.query;

        if (querySchema instanceof z.ZodObject) {
          Object.entries((querySchema as any).shape).forEach(([key, value]) => {
            if (value instanceof z.ZodType) {
              parameters.push({
                name: key,
                in: "query",
                required: !(value instanceof z.ZodOptional),
                schema: this.processZodType(value as z.ZodType<any>),
              });
            }
          });
        }
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
    const operation: any = {
      summary: this.generateSummary(route.path, method),
      description: this.generateDescription(route.path, method),
      operationId: this.generateOperationId(route.path, method),
      tags: this.generateTags(route.path),
      security: [{ bearerAuth: [] }, { apiKeyCookie: [] }],
      responses: this.getStandardResponses(),
    };

    // Add query parameters
    const parameters = await this.getParameters(route, method);
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }

    // QUERY and mutation methods can carry typed request content.
    if (["QUERY", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      operation.requestBody = await this.getRequestBody(route, method);
    }

    return operation;
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
