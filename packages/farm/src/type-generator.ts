import { readFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, relative, dirname } from "path";
import { writeFileIfChanged } from "./write-file-if-changed";
import { isFarmAPIRouteFileName } from "./api/route-files";

export interface APIRouteInfo {
  path: string;
  methods: string[];
  filePath: string;
  relativePath: string;
}

export class APITypeGenerator {
  private appDirs: string[];

  constructor(appDir: string | readonly string[]) {
    this.appDirs = Array.isArray(appDir) ? [...appDir] : [appDir as string];
  }

  /**
   * Scan all API route files and extract route information
   */
  scanAPIRoutes(): APIRouteInfo[] {
    const routes = new Map<string, APIRouteInfo>();

    for (const appDir of this.appDirs) {
      const apiDir = join(appDir, "api");
      if (!existsSync(apiDir)) continue;

      const discovered: APIRouteInfo[] = [];
      this.scanDirectory(apiDir, appDir, discovered);
      for (const route of discovered) {
        routes.set(route.path, route);
      }
    }

    return Array.from(routes.values()).sort((left, right) => left.path.localeCompare(right.path));
  }

  private scanDirectory(dir: string, appDir: string, routes: APIRouteInfo[], basePath = "") {
    const items = readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = join(dir, item.name);

      if (item.isDirectory()) {
        const newBasePath = basePath ? `${basePath}/${item.name}` : item.name;
        this.scanDirectory(fullPath, appDir, routes, newBasePath);
      } else if (isFarmAPIRouteFileName(item.name)) {
        const routeInfo = this.extractRouteInfo(fullPath, appDir, basePath);
        if (routeInfo) {
          routes.push(routeInfo);
        }
      }
    }
  }

  private extractRouteInfo(
    filePath: string,
    appDir: string,
    basePath: string,
  ): APIRouteInfo | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      const methods = this.extractExportedMethods(content);

      if (methods.length === 0) {
        return null;
      }

      const relativePath = relative(appDir, filePath);
      const apiPath = basePath ? `/api/${basePath}` : "/api";

      return {
        path: apiPath,
        methods,
        filePath,
        relativePath,
      };
    } catch (error) {
      console.warn(`Failed to read route file ${filePath}:`, error);
      return null;
    }
  }

  private extractExportedMethods(content: string): string[] {
    const methods: string[] = [];
    const httpMethods = ["GET", "HEAD", "QUERY", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
    const namedExports = new Set<string>();

    for (const match of content.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
      for (const specifier of match[1].split(",")) {
        const normalized = specifier.trim().replace(/^type\s+/, "");
        if (!normalized) continue;

        const alias = normalized.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        const exportedName = alias?.[2] ?? normalized.match(/^([A-Za-z_$][\w$]*)$/)?.[1];
        if (exportedName) namedExports.add(exportedName);
      }
    }

    for (const method of httpMethods) {
      // Look for a direct declaration or the name exposed by an export list.
      const patterns = [
        new RegExp(`export\\s+(?:const|let|var)\\s+${method}\\s*(?::|=)`, "g"),
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, "g"),
      ];

      if (namedExports.has(method) || patterns.some((pattern) => pattern.test(content))) {
        methods.push(method);
      }
    }

    return methods;
  }

  /**
   * Generate TypeScript code for the API router
   */
  generateAPIRouter(routes: APIRouteInfo[], options: { outFile?: string } = {}): string {
    const imports: string[] = [];

    // Group routes by path to handle multiple methods
    const routeGroups = new Map<string, APIRouteInfo[]>();

    for (const route of routes) {
      const key = route.path;
      if (!routeGroups.has(key)) {
        routeGroups.set(key, []);
      }
      routeGroups.get(key)!.push(route);
    }

    // Build nested structure
    const nestedStructure: any = {};
    const usedRouteNames = new Map<string, number>();

    for (const [path, routeList] of routeGroups) {
      const route = routeList[0];
      const importPath = this.getRouteImportPath(route, options.outFile);
      const routeName = this.uniqueRouteName(route.path, usedRouteNames);
      const cleanPath = path === "/api" ? "" : path.replace(/^\/api\//, "");
      const parts = cleanPath ? cleanPath.split("/") : [];

      // Collect all methods for this route
      const allMethods = routeList.flatMap((r) => r.methods);

      // Generate imports
      for (const method of allMethods) {
        const importName = `${method}_${routeName}`;
        imports.push(
          `import type { ${method} as ${importName} } from ${JSON.stringify(importPath)};`,
        );
      }

      if (parts.length === 0) {
        for (const method of allMethods) {
          const importName = `${method}_${routeName}`;
          const methodName = method.toLowerCase();
          nestedStructure[methodName] = `typeof ${importName}`;
        }
      } else {
        // Build nested object
        let current = nestedStructure;
        for (let i = 0; i < parts.length; i++) {
          const part = parts[i];
          if (i === parts.length - 1) {
            // Last part - add methods
            current[part] = {};
            for (const method of allMethods) {
              const importName = `${method}_${routeName}`;
              const methodName = method.toLowerCase();
              current[part][methodName] = `typeof ${importName}`;
            }
          } else {
            // Intermediate part - create nested object
            if (!current[part]) {
              current[part] = {};
            }
            current = current[part];
          }
        }
      }
    }

    // Convert nested structure to TypeScript code
    const typeExports = this.structureToTypeString(nestedStructure, 1);

    return `/**
 * Auto-generated API router types
 * This file is automatically generated - do not edit manually
 *
 * This file contains only TypeScript types for the API client.
 * Runtime imports are used only at the type level.
 */

${imports.join("\n")}

// Type-only representation of your API routes
export type APIRouter = {
${typeExports}
};
`;
  }

  private getRouteImportPath(route: APIRouteInfo, outFile?: string): string {
    if (!outFile) {
      return `../app/${route.relativePath.replace(/\\/g, "/").replace(/\.(ts|tsx|js|jsx)$/, "")}`;
    }

    const relativeImport = relative(dirname(outFile), route.filePath)
      .replace(/\\/g, "/")
      .replace(/\.(ts|tsx|js|jsx)$/, "");
    return relativeImport.startsWith(".") ? relativeImport : `./${relativeImport}`;
  }

  private pathToRouteName(path: string): string {
    // Replace (not strip) invalid identifier characters, so /api/id and
    // /api/[id] do not normalize to the same name.
    return (path === "/api" ? "root" : path.replace(/^\/api\//, ""))
      .replace(/\//g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "_");
  }

  private uniqueRouteName(path: string, usedNames: Map<string, number>): string {
    const base = this.pathToRouteName(path);
    const seen = usedNames.get(base);
    usedNames.set(base, (seen ?? 0) + 1);
    // Suffix any remaining collision so the generated import aliases are
    // always distinct identifiers.
    return seen ? `${base}_${seen + 1}` : base;
  }

  private structureToTypeString(obj: any, indent: number): string {
    const spaces = "  ".repeat(indent);
    const lines: string[] = [];

    for (const [key, value] of Object.entries(obj)) {
      const propertyKey = this.toTypePropertyKey(key);

      if (typeof value === "string") {
        // It's a type reference
        lines.push(`${spaces}${propertyKey}: ${value};`);
      } else if (typeof value === "object") {
        // It's a nested object
        lines.push(`${spaces}${propertyKey}: {`);
        lines.push(this.structureToTypeString(value, indent + 1));
        lines.push(`${spaces}};`);
      }
    }

    return lines.join("\n");
  }

  private toTypePropertyKey(key: string): string {
    return /^[$A-Z_][0-9A-Z_$]*$/i.test(key) ? key : JSON.stringify(key);
  }

  private getBaseExportName(path: string): string {
    const cleanPath = path.replace(/^\/api\//, "");

    if (cleanPath === "") {
      return "api";
    }

    // Convert path to nested structure
    // /api/auth/login -> ['auth', 'login']
    return cleanPath;
  }

  private getExportName(path: string, method: string): string {
    const cleanPath = path.replace(/^\/api\//, "");

    if (cleanPath === "") {
      return method.toLowerCase();
    }

    const parts = cleanPath.split("/");
    if (parts.length === 1) {
      // For single-level paths like /api/hello, just use the path name
      return parts[0];
    }

    // For nested paths like /api/auth/login, create nested structure
    // This matches the expected API client usage: api.auth.login()
    return parts.join(".");
  }

  /**
   * Generate the API index file
   */
  generateAPIIndex(outputPath: string): void {
    const routes = this.scanAPIRoutes();
    const content = this.generateAPIRouter(routes);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileIfChanged(outputPath, content);
    console.log(`✅ Generated API types for ${routes.length} routes`);
  }
}
