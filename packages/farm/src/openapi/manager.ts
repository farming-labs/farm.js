import { OpenAPIGenerator, type OpenAPISpec } from "./generator";
import { APITypeGenerator } from "../type-generator";
import type { OpenAPIConfig } from "../config";

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderOpenAPIReferenceHTML(spec: OpenAPISpec, config: OpenAPIConfig): string {
  return `
<!DOCTYPE html>
<html>
  <head>
    <title>${escapeHTML(config.title || "API Documentation")}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="icon" href="data:," />
  </head>
  <body>
    <script
      id="api-reference"
      data-url="data:application/json;base64,${Buffer.from(JSON.stringify(spec)).toString("base64")}"
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>
    `;
}

export class OpenAPIManager {
  private generator: OpenAPIGenerator;
  private apiTypeGenerator: APITypeGenerator;
  private config: OpenAPIConfig;
  private appDir: string;
  private specCache: any = null;

  constructor(appDir: string | readonly string[], config: OpenAPIConfig) {
    const appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
    this.appDir = appDirs[appDirs.length - 1];
    this.config = config;
    this.generator = new OpenAPIGenerator(this.appDir, config);
    this.apiTypeGenerator = new APITypeGenerator(appDirs);
  }

  /**
   * Generate OpenAPI spec from API routes
   */
  async generateSpec(): Promise<any> {
    try {
      // Get API routes using the existing type generator
      const routes = this.apiTypeGenerator.scanAPIRoutes();

      // Generate OpenAPI spec (now async)
      const spec = await this.generator.generateSpec(routes);

      // Cache the spec
      this.specCache = spec;

      return spec;
    } catch (error) {
      console.error("Failed to generate OpenAPI spec:", error);
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
      const routes = this.apiTypeGenerator.scanAPIRoutes();
      const outputPath = `${this.appDir}/lib/openapi.spec.json`;

      await this.generator.generateSpecFile(routes, outputPath);
      console.log("✅ OpenAPI spec generated at:", outputPath);
    } catch (error) {
      console.error("Failed to generate OpenAPI spec file:", error);
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
        const method = String(req.method || "GET").toUpperCase();
        if (method !== "GET" && method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET, HEAD");
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Method Not Allowed");
          return;
        }

        const spec = await this.getSpec();

        if (!spec) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/html");
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
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        res.setHeader("X-Content-Type-Options", "nosniff");

        // Generate HTML with Scalar
        res.end(method === "HEAD" ? undefined : renderOpenAPIReferenceHTML(spec, this.config));
      } catch (error) {
        console.error("Error serving docs route:", error);
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/html");
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
}
