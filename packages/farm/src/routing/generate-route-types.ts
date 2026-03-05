import * as path from "path";
import * as fs from "fs";
import { parseRoutePath } from "../utils";
import type { ParsedRoute } from "../types";

function routePatternToTsTypeLiteral(pattern: string): string {
  if (pattern === "/") return '"/"';
  const segments = pattern.slice(1).split("/").filter(Boolean);
  const hasDynamic = segments.some((s) => s.startsWith("["));
  if (!hasDynamic) return JSON.stringify(pattern);
  const parts = segments.map((s) => {
    if (s.startsWith("[[...") || s.startsWith("[...")) return "${string}";
    if (s.startsWith("[")) return "${string}";
    return s;
  });
  return "`/" + parts.join("/") + "`";
}

function createRoutePattern(route: ParsedRoute): string {
  if (route.segments.length === 0) return "/";
  return (
    "/" +
    route.segments
      .map((seg) => {
        if (!seg.isDynamic) return seg.segment;
        if (seg.isCatchAll) return seg.isOptional ? `[[...${seg.segment}]]` : `[...${seg.segment}]`;
        return `[${seg.segment}]`;
      })
      .join("/")
  );
}

export interface GenerateRouteTypesOptions {
  root: string;
  srcDir?: string;
  outFile?: string;
}

const DEFAULT_OUT_FILE = "farm-routes.d.ts";

/**
 * Scan app directory for page files, generate RoutePath union type,
 * and write a .d.ts file for typed Link href.
 */
export async function generateRouteTypes(options: GenerateRouteTypesOptions): Promise<string> {
  const { root, srcDir = "src", outFile = DEFAULT_OUT_FILE } = options;
  const appDir = path.join(root, srcDir, "app");

  if (!fs.existsSync(appDir)) {
    return path.join(root, srcDir, outFile);
  }

  const glob = await import("fast-glob");
  const pageFiles = await glob.default("**/page.{ts,tsx,js,jsx}", { cwd: appDir, absolute: false });

  const patterns = new Set<string>();
  for (const file of pageFiles) {
    const route = parseRoutePath(file);
    if (route.type === "page") {
      const pattern = createRoutePattern(route);
      patterns.add(pattern);
    }
  }

  const typeLiterals = Array.from(patterns)
    .sort()
    .map(routePatternToTsTypeLiteral);

  const content = `/**
 * Auto-generated route types from src/app.
 * Link href is typed automatically via module augmentation. Regenerated on dev start and when routes change.
 */
export type RoutePath = ${typeLiterals.join(" | ")};

declare module "@farmjs/core/client" {
  interface LinkDefaultRoute {
    _: RoutePath;
  }
}
`;

  const outPath = path.join(root, srcDir, outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, "utf8");

  return outPath;
}
