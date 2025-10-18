import type { OpenAPIConfig } from '../config';
import type { APIRouteInfo } from '../type-generator';

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
  };
}

export class OpenAPIGenerator {
  private config: OpenAPIConfig;
  private appDir: string;

  constructor(appDir: string, config: OpenAPIConfig) {
    this.appDir = appDir;
    this.config = config;
  }

  /**
   * Generate OpenAPI spec from API routes
   */
  generateSpec(routes: APIRouteInfo[]): OpenAPISpec {
    const spec: OpenAPISpec = {
      openapi: '3.0.3',
      info: {
        title: this.config.title || 'API Documentation',
        description: this.config.description || 'Auto-generated API documentation',
        version: this.config.version || '1.0.0',
        ...(this.config.contact && { contact: this.config.contact }),
        ...(this.config.license && { license: this.config.license }),
      },
      servers: this.config.servers || [
        { url: 'http://localhost:3000', description: 'Development server' }
      ],
      paths: {},
      components: {
        schemas: {}
      }
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
          const methodLower = method.toLowerCase();
          spec.paths[openAPIPath][methodLower] = this.generateOperation(route, method);
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
    return path.replace(/^\/api/, '');
  }

  /**
   * Generate OpenAPI operation from route info
   */
  private generateOperation(route: APIRouteInfo, method: string): any {
    const operation: any = {
      summary: this.generateSummary(route.path, method),
      description: this.generateDescription(route.path, method),
      operationId: this.generateOperationId(route.path, method),
      tags: this.generateTags(route.path),
      responses: {
        '200': {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                description: 'Response data'
              }
            }
          }
        },
        '400': {
          description: 'Bad Request',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        },
        '500': {
          description: 'Internal Server Error',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  error: { type: 'string' }
                }
              }
            }
          }
        }
      }
    };

    // Add request body for POST, PUT, PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      operation.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              description: 'Request body'
            }
          }
        }
      };
    }

    // Add query parameters for GET requests
    if (method === 'GET') {
      operation.parameters = [
        {
          name: 'query',
          in: 'query',
          required: false,
          schema: {
            type: 'object',
            description: 'Query parameters'
          }
        }
      ];
    }

    return operation;
  }

  /**
   * Generate operation summary
   */
  private generateSummary(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, '');
    const pathParts = cleanPath.split('/');
    const lastPart = pathParts[pathParts.length - 1];
    
    const action = method === 'GET' ? 'Get' : 
                  method === 'POST' ? 'Create' :
                  method === 'PUT' ? 'Update' :
                  method === 'DELETE' ? 'Delete' :
                  method === 'PATCH' ? 'Update' : method;
    
    return `${action} ${lastPart}`;
  }

  /**
   * Generate operation description
   */
  private generateDescription(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, '');
    return `${method} ${cleanPath} endpoint`;
  }

  /**
   * Generate operation ID
   */
  private generateOperationId(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, '').replace(/\//g, '_');
    return `${method.toLowerCase()}_${cleanPath}`;
  }

  /**
   * Generate tags for grouping operations
   */
  private generateTags(path: string): string[] {
    const cleanPath = path.replace(/^\/api\//, '');
    const pathParts = cleanPath.split('/');
    
    if (pathParts.length > 1) {
      return [pathParts[0]]; // Use first part as tag
    }
    
    return ['default'];
  }

  /**
   * Generate OpenAPI spec file
   */
  generateSpecFile(routes: APIRouteInfo[], outputPath: string): void {
    const spec = this.generateSpec(routes);
    const fs = require('fs');
    const path = require('path');
    
    // Ensure directory exists
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    // Write spec file
    fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
  }
}

