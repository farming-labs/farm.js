import { OpenAPIGenerator } from './generator';
import { APITypeGenerator } from '../type-generator';
import type { OpenAPIConfig } from '../config';
import type { APIRouteInfo } from '../type-generator';

export class OpenAPIManager {
  private generator: OpenAPIGenerator;
  private apiTypeGenerator: APITypeGenerator;
  private config: OpenAPIConfig;
  private appDir: string;
  private specCache: any = null;

  constructor(appDir: string, config: OpenAPIConfig) {
    this.appDir = appDir;
    this.config = config;
    this.generator = new OpenAPIGenerator(appDir, config);
    this.apiTypeGenerator = new APITypeGenerator(appDir);
  }

  /**
   * Generate OpenAPI spec from API routes
   */
  async generateSpec(): Promise<any> {
    try {
      // Get API routes using the existing type generator
      const routes = await this.apiTypeGenerator.scanAPIRoutes(`${this.appDir}/api`);
      
      // Generate OpenAPI spec
      const spec = this.generator.generateSpec(routes);
      
      // Cache the spec
      this.specCache = spec;
      
      return spec;
    } catch (error) {
      console.error('Failed to generate OpenAPI spec:', error);
      return null;
    }
  }

  /**
   * Get cached spec or generate new one
   */
  async getSpec(): Promise<any> {
    if (this.specCache) {
      return this.specCache;
    }
    
    return await this.generateSpec();
  }

  /**
   * Generate and save OpenAPI spec file
   */
  async generateSpecFile(): Promise<void> {
    try {
      const routes = await this.apiTypeGenerator.scanAPIRoutes(`${this.appDir}/api`);
      const outputPath = `${this.appDir}/lib/openapi.spec.json`;
      
      this.generator.generateSpecFile(routes, outputPath);
      console.log('✅ OpenAPI spec generated at:', outputPath);
    } catch (error) {
      console.error('Failed to generate OpenAPI spec file:', error);
    }
  }

  /**
   * Invalidate cache and regenerate spec
   */
  async invalidateCache(): Promise<void> {
    this.specCache = null;
    await this.generateSpec();
  }

  /**
   * Get the docs route handler
   */
  getDocsRouteHandler() {
    return async (req: any, res: any) => {
      try {
        const spec = await this.getSpec();
        
        if (!spec) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'text/html');
          res.end(`
            <html>
              <body>
                <h1>Error</h1>
                <p>Failed to generate OpenAPI specification</p>
              </body>
            </html>
          `);
          return;
        }

        // Set headers for HTML response
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html');
        
        // Generate HTML with Scalar
        const html = this.generateDocsHTML(spec);
        res.end(html);
      } catch (error) {
        console.error('Error serving docs route:', error);
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/html');
        res.end(`
          <html>
            <body>
              <h1>Error</h1>
              <p>Failed to load API documentation</p>
            </body>
          </html>
        `);
      }
    };
  }

  /**
   * Generate HTML for docs route
   */
  private generateDocsHTML(spec: any): string {
    return `
<!DOCTYPE html>
<html>
  <head>
    <title>${this.config.title || 'API Documentation'}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="data:application/json;base64,${Buffer.from(JSON.stringify(spec)).toString('base64')}"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
    `;
  }
}
