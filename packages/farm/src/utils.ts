import type { RouteSegment, ParsedRoute } from "./types";
import path from "path";

export function parseRoutePath(filePath: string): ParsedRoute {
  const segments: RouteSegment[] = [];
  const normalizedPath = filePath.replace(/\\/g, "/");
  const pathParts = normalizedPath.split("/").filter(Boolean);

  const fileName = pathParts.pop() || "";
  const fileType = getRouteType(fileName);

  for (const part of pathParts) {
    if (part.startsWith("[") && part.endsWith("]")) {
      let segment = part.slice(1, -1);
      const isDynamic = true;
      let isOptional = false;
      let isCatchAll = false;

      if (segment.startsWith("[") && segment.endsWith("]")) {
        isOptional = true;
        segment = segment.slice(1, -1);
        if (segment.startsWith("...")) {
          segment = segment.slice(3);
          isCatchAll = true;
        }
      } else if (segment.startsWith("...")) {
        segment = segment.slice(3);
        isCatchAll = true;
      }

      segments.push({ segment, isDynamic, isOptional, isCatchAll });
    } else {
      segments.push({
        segment: part,
        isDynamic: false,
        isOptional: false,
        isCatchAll: false,
      });
    }
  }

  return {
    segments,
    filePath: normalizedPath,
    type: fileType,
  };
}

function getRouteType(fileName: string): ParsedRoute["type"] {
  const baseName = fileName.replace(/\.(tsx?|jsx?|vue|mdx?|markdown)$/, "");

  switch (baseName) {
    case "page":
      return "page";
    case "layout":
      return "layout";
    case "loading":
      return "loading";
    case "error":
      return "error";
    case "not-found":
      return "not-found";
    default:
      return "page";
  }
}

export function segmentsToPattern(segments: RouteSegment[]): string {
  if (segments.length === 0) return "/";

  return (
    "/" +
    segments
      .map((segment) => {
        if (!segment.isDynamic) return segment.segment;

        if (segment.isCatchAll) {
          return segment.isOptional ? `*${segment.segment}?` : `*${segment.segment}`;
        }

        return `:${segment.segment}`;
      })
      .join("/")
  );
}

export function matchRoute(
  url: string,
  segments: RouteSegment[],
): { params: Record<string, string>; matches: boolean } {
  const urlParts = url.split("/").filter(Boolean);
  const params: Record<string, string> = {};
  if (segments.length === 0) {
    return { params, matches: urlParts.length === 0 };
  }

  let urlIndex = 0;
  let segmentIndex = 0;

  while (segmentIndex < segments.length && urlIndex <= urlParts.length) {
    const segment = segments[segmentIndex];

    if (!segment.isDynamic) {
      if (urlParts[urlIndex] !== segment.segment) {
        return { params: {}, matches: false };
      }
      urlIndex++;
      segmentIndex++;
    } else if (segment.isCatchAll) {
      const remainingParts = urlParts.slice(urlIndex);

      if (remainingParts.length === 0 && !segment.isOptional) {
        return { params: {}, matches: false };
      }

      params[segment.segment] = remainingParts.join("/");
      urlIndex = urlParts.length;
      segmentIndex++;
    } else {
      if (urlIndex >= urlParts.length) {
        return { params: {}, matches: false };
      }

      params[segment.segment] = urlParts[urlIndex];
      urlIndex++;
      segmentIndex++;
    }
  }

  const matches = segmentIndex === segments.length && urlIndex === urlParts.length;

  return { params, matches };
}

export function resolveAppPath(root: string, ...paths: string[]): string {
  return path.resolve(root, ...paths);
}

export function toViteModuleId(filePath: string, root: string): string {
  if (!path.isAbsolute(filePath)) return filePath;

  const relativePath = path.relative(root, filePath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return `/${relativePath.split(path.sep).join("/")}`;
  }

  const normalizedPath = filePath.replace(/\\/g, "/");
  return normalizedPath.startsWith("/") ? `/@fs${normalizedPath}` : `/@fs/${normalizedPath}`;
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    const fs = await import("fs/promises");
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function globFiles(pattern: string, cwd: string): Promise<string[]> {
  const glob = await import("fast-glob");
  return glob.default(pattern, { cwd, absolute: false });
}

export function parseSearchParams(
  searchParams: URLSearchParams,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        result[key] = [existing, value];
      }
    } else {
      result[key] = value;
    }
  }

  return result;
}

export const logger = {
  info: (message: string) => console.log(`[info] ${message}`),
  success: (message: string) => console.log(`[success] ${message}`),
  warn: (message: string) => console.warn(`⚠️  ${message}`),
  error: (message: string) => console.error(`❌ ${message}`),
  ready: (message: string) => console.log(`${message}`),
  event: (message: string) => console.log(`  ${message}`),
};
