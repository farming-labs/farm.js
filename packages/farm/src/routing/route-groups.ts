import type { ParsedRoute, RouteSegment } from "../types";

// Route groups like `(auth)` organize files without adding a URL segment, so two
// layouts can share a URL ("/" for both `layout.tsx` and `(auth)/layout.tsx`).
// Layouts, loading and error boundaries are therefore identified by their app
// directory with groups kept ("/(auth)"). URL matching still decides whether a
// boundary covers a pathname; a boundary under a group additionally covers only
// the pages inside that group, like the Next.js app router.

export function isRouteGroupSegment(part: string): boolean {
  return part.startsWith("(") && part.endsWith(")");
}

export function formatRouteSegment(segment: RouteSegment): string {
  if (!segment.isDynamic) return segment.segment;
  if (segment.isCatchAll) {
    return segment.isOptional ? `[[...${segment.segment}]]` : `[...${segment.segment}]`;
  }
  return `[${segment.segment}]`;
}

/**
 * The app directory of a parsed route file in pattern form, groups included:
 * `(auth)/sign-in/page.tsx` -> `/(auth)/sign-in`. Without groups this is the
 * route's URL pattern.
 */
export function createRouteDirectoryPattern(route: ParsedRoute): string {
  const parts = route.filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  if (parts.length === 0) return "/";

  let segmentIndex = 0;
  const directory = parts.map((part) => {
    if (isRouteGroupSegment(part)) return part;
    const segment = route.segments[segmentIndex++];
    return segment ? formatRouteSegment(segment) : part;
  });
  return `/${directory.join("/")}`;
}

/** The URL pattern of a directory pattern: `/(shop)/cart` -> `/cart`. */
export function stripRouteGroups(pattern: string): string {
  if (!pattern.includes("(")) return pattern;
  const parts = pattern.split("/").filter((part) => part && !isRouteGroupSegment(part));
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

/**
 * The directory a grouped boundary is confined to (its pattern up to and including
 * the last group), or null when only its URL decides what it covers.
 */
export function getRouteGroupScope(pattern: string): string | null {
  if (!pattern.includes("(")) return null;
  const parts = pattern.split("/");
  for (let index = parts.length - 1; index > 0; index--) {
    if (isRouteGroupSegment(parts[index]!)) return parts.slice(0, index + 1).join("/");
  }
  return null;
}

/**
 * Whether a page directory sits inside a group scope. A null scope covers every page;
 * a missing directory (no page matched) is inside no group.
 */
export function isInRouteGroupScope(
  directory: string | null | undefined,
  scope: string | null,
): boolean {
  if (scope === null) return true;
  if (typeof directory !== "string") return false;
  return directory === scope || directory.startsWith(`${scope}/`);
}

/** Directory depth, groups included: the order layouts nest in, root first. */
export function getRouteDirectoryDepth(pattern: string): number {
  return pattern.split("/").filter(Boolean).length;
}

/**
 * Build-time check that a layout or boundary pattern covers a page, given the page's
 * directory pattern. Ungrouped patterns keep the URL-prefix rule; a grouped one must
 * also contain the page.
 */
export function routeBoundaryCoversDirectory(boundaryPattern: string, directory: string): boolean {
  const boundaryUrl = stripRouteGroups(boundaryPattern);
  const routeUrl = stripRouteGroups(directory);
  return (
    (boundaryUrl === "/" ||
      routeUrl === boundaryUrl ||
      routeUrl.startsWith(`${boundaryUrl.replace(/\/$/, "")}/`)) &&
    isInRouteGroupScope(directory, getRouteGroupScope(boundaryPattern))
  );
}
