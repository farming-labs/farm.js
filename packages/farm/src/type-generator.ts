import { readFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join, relative, dirname } from "path";
import { initSync, parse } from "es-module-lexer";
import { writeFileIfChanged } from "./write-file-if-changed";
import { registerAPIRouteShape } from "./api/route-shape";
import { isFarmAPIRouteFileName } from "./api/route-files";

let moduleLexerInitialized = false;

const API_CLIENT_METHOD_SEGMENTS = new Set([
  "get",
  "head",
  "query",
  "post",
  "put",
  "delete",
  "patch",
  "options",
]);

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
    const methodSources = new Map<string, Map<string, APIRouteInfo>>();

    for (const appDir of this.appDirs) {
      const apiDir = join(appDir, "api");
      if (!existsSync(apiDir)) continue;

      const discovered: APIRouteInfo[] = [];
      this.scanDirectory(apiDir, appDir, discovered);
      for (const route of discovered) {
        const routeMethods = methodSources.get(route.path) ?? new Map<string, APIRouteInfo>();
        for (const method of route.methods) {
          routeMethods.set(method, route);
        }
        methodSources.set(route.path, routeMethods);
      }
    }

    const routes: APIRouteInfo[] = [];
    for (const [routePath, methods] of methodSources) {
      const routesByFile = new Map<string, APIRouteInfo>();
      for (const [method, route] of methods) {
        const existing = routesByFile.get(route.filePath);
        if (existing) {
          existing.methods.push(method);
        } else {
          routesByFile.set(route.filePath, {
            ...route,
            path: routePath,
            methods: [method],
          });
        }
      }
      routes.push(...routesByFile.values());
    }

    return routes.sort(
      (left, right) =>
        left.path.localeCompare(right.path) || left.filePath.localeCompare(right.filePath),
    );
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
    if (!moduleLexerInitialized) {
      initSync();
      moduleLexerInitialized = true;
    }
    const httpMethods = ["GET", "HEAD", "QUERY", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];
    const [, exports] = parse(content);
    const valueExports = new Set(
      exports
        .filter((specifier) => !this.isTypeOnlyExportSpecifier(content, specifier.s))
        .map((specifier) => specifier.n),
    );
    return httpMethods.filter((method) => valueExports.has(method));
  }

  private isTypeOnlyExportSpecifier(content: string, exportNameStart: number): boolean {
    let cursor = exportNameStart - 1;

    while (cursor >= 0) {
      while (cursor >= 0 && /\s/.test(content[cursor])) cursor--;

      if (content.slice(cursor - 1, cursor + 1) === "*/") {
        const commentStart = content.lastIndexOf("/*", cursor - 1);
        if (commentStart >= 0) {
          cursor = commentStart - 1;
          continue;
        }
      }

      const lineStart = content.lastIndexOf("\n", cursor) + 1;
      const lineCommentStart = content.indexOf("//", lineStart);
      if (lineCommentStart >= 0 && lineCommentStart <= cursor) {
        cursor = lineCommentStart - 1;
        continue;
      }

      break;
    }

    const tokenEnd = cursor + 1;
    while (cursor >= 0 && /[A-Za-z0-9_$]/.test(content[cursor])) cursor--;
    return content.slice(cursor + 1, tokenEnd) === "type";
  }

  /**
   * Generate TypeScript code for the API router
   */
  generateAPIRouter(
    routes: APIRouteInfo[],
    options: {
      outFile?: string;
      pluginConfigs?: readonly string[];
      pluginRoutes?: readonly { path: string; method: string }[];
    } = {},
  ): string {
    const imports: string[] = [];
    const pluginTypes: string[] = [];
    if (options.pluginConfigs?.length) {
      imports.push('import type { PluginAPIRouter } from "@farm.js/core/api";');
      options.pluginConfigs.forEach((filePath, index) => {
        const importPath = this.getRouteImportPath({ filePath } as APIRouteInfo, options.outFile);
        imports.push(`import type FarmPluginConfig${index} from ${JSON.stringify(importPath)};`);
        pluginTypes.push(`PluginAPIRouter<typeof FarmPluginConfig${index}>`);
      });
    }

    // Group routes by path to handle multiple methods
    const routeGroups = new Map<string, APIRouteInfo[]>();

    for (const route of routes) {
      const key = route.path;
      if (!routeGroups.has(key)) {
        routeGroups.set(key, []);
      }
      routeGroups.get(key)!.push(route);
    }

    const routeMethodsByPath = new Map<string, Set<string>>();
    for (const [routePath, routeList] of routeGroups) {
      const cleanPath = routePath === "/api" ? "" : routePath.replace(/^\/api\//, "");
      routeMethodsByPath.set(
        cleanPath,
        new Set(routeList.flatMap((route) => route.methods.map((method) => method.toLowerCase()))),
      );
    }
    for (const route of options.pluginRoutes ?? []) {
      const cleanPath = route.path === "/api" ? "" : route.path.replace(/^\/api\//, "");
      const methods = routeMethodsByPath.get(cleanPath) ?? new Set<string>();
      methods.add(route.method.toLowerCase());
      routeMethodsByPath.set(cleanPath, methods);
    }

    // Build nested structure
    const nestedStructure: any = {};
    const usedRouteNames = new Map<string, number>();

    for (const [path, routeList] of routeGroups) {
      const routeName = this.uniqueRouteName(path, usedRouteNames);
      const cleanPath = path === "/api" ? "" : path.replace(/^\/api\//, "");
      const parts = cleanPath ? cleanPath.split("/") : [];

      // Keep the final source for each method, matching runtime layer precedence.
      const methodSources = new Map<string, APIRouteInfo>();
      for (const route of routeList) {
        for (const method of route.methods) methodSources.set(method, route);
      }
      const allMethods = [...methodSources.keys()];

      // Generate imports
      for (const method of allMethods) {
        const importPath = this.getRouteImportPath(methodSources.get(method)!, options.outFile);
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
        const hasMethodCollision = parts.some((part, index) => {
          if (part === "$params" || (index === 0 && part === "integrations")) return true;
          if (!API_CLIENT_METHOD_SEGMENTS.has(part)) return false;
          const parentPath = parts.slice(0, index).join("/");
          return routeMethodsByPath.get(parentPath)?.has(part) === true;
        });
        const typePath = hasMethodCollision ? [`/${cleanPath}`] : parts;
        // Build nested object
        let current = nestedStructure;
        for (let i = 0; i < typePath.length; i++) {
          const part = typePath[i];
          if (i === typePath.length - 1) {
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
    const manifest = new Map<string, Set<string>>();
    const shapes = new Map();
    for (const route of routes) {
      registerAPIRouteShape(shapes, route.path, route.filePath, "app");
      const methods = manifest.get(route.path) ?? new Set<string>();
      for (const method of route.methods) methods.add(method);
      manifest.set(route.path, methods);
    }
    for (const route of options.pluginRoutes ?? []) {
      registerAPIRouteShape(shapes, route.path, `plugin:${route.path}`, "app");
      const methods = manifest.get(route.path) ?? new Set<string>();
      if (methods.has(route.method))
        throw new Error(`Duplicate API route for ${route.method} ${route.path}`);
      methods.add(route.method);
      manifest.set(route.path, methods);
    }
    const routeManifest = [...manifest]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, methods]) => ({ path, methods: [...methods].sort() }));
    const manifestSource = routeManifest.length
      ? `[\n${routeManifest
          .map(
            ({ path, methods }) =>
              `  {\n    path: ${JSON.stringify(path)},\n    methods: [${methods.map((method) => JSON.stringify(method)).join(", ")}],\n  },`,
          )
          .join("\n")}\n]`
      : "[]";

    return `/**
 * Auto-generated API router types
 * This file is automatically generated - do not edit manually
 *
 * Server modules are imported only as types. Runtime data contains paths and methods only.
 */

${imports.join("\n")}

// Type-only representation of your API routes
export type APIRouter = ${pluginTypes.length ? `${pluginTypes.join(" & ")} & ` : ""}{
${typeExports}
};

// Pass this schema-free manifest to createApiClients({ routes: apiRoutes }).
export const apiRoutes = ${manifestSource} as const;
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
    const content = this.generateAPIRouter(routes, { outFile: outputPath });

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileIfChanged(outputPath, content);
    console.log(`✅ Generated API types for ${routes.length} routes`);
  }
}
