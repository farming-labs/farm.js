// Route-group layouts, as in Next.js: `app/(home)/layout.tsx` wraps only the pages inside
// `app/(home)/`, though its URL is `/` like `app/layout.tsx`. A layout whose folder has no route
// group keeps URL-prefix matching, so it wraps every page under its URL.

function isRouteGroup(part: string): boolean {
  return part.startsWith("(") && part.endsWith(")");
}

/** A route file's folder, relative to the app directory, with `/` separators: `""` for the root. */
export function getFarmRouteDirectory(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

/**
 * The folder a layout is scoped to when the folder is inside a route group, such as `"(home)"`
 * for `(home)/layout.tsx`; `undefined` for a layout that URL-prefix matching places.
 */
export function getFarmLayoutScope(layoutFilePath: string): string | undefined {
  const directory = getFarmRouteDirectory(layoutFilePath);
  return directory.split("/").some(isRouteGroup) ? directory : undefined;
}

/**
 * A layout's identity: its URL pattern, with the route-group folders kept for a layout inside a
 * group (`"/(home)"`), so it never collides with the layout at the same URL (`"/"`).
 */
export function getFarmLayoutPattern(urlPattern: string, layoutFilePath: string): string {
  const scope = getFarmLayoutScope(layoutFilePath);
  return scope === undefined ? urlPattern : `/${scope}`;
}

/**
 * Whether a layout scoped to `scope` wraps the page in `pageDirectory`. An unscoped layout always
 * does (its URL decides). A scoped one needs the page inside its folder, so it never wraps a page
 * Farm matched without a page file, such as the not-found page.
 */
export function farmLayoutScopeContains(
  scope: string | undefined,
  pageDirectory: string | undefined,
): boolean {
  if (scope === undefined) return true;
  if (pageDirectory === undefined) return false;
  return pageDirectory === scope || pageDirectory.startsWith(`${scope}/`);
}

/** The folder a layout pattern is scoped to: `"(home)"` for `"/(home)"`, `undefined` for `"/docs"`. */
export function getFarmLayoutPatternScope(layoutPattern: string): string | undefined {
  const parts = layoutPattern.split("/").filter(Boolean);
  return parts.some(isRouteGroup) ? parts.join("/") : undefined;
}

/** A layout pattern's URL: `"/(home)/blog"` is `"/blog"`. */
export function getFarmLayoutUrlPattern(layoutPattern: string): string {
  return `/${layoutPattern
    .split("/")
    .filter((part) => part && !isRouteGroup(part))
    .join("/")}`;
}

/**
 * Whether a layout wraps a page route, for the build, which knows both by pattern: its URL is a
 * prefix of the route's, and a route-group layout needs the page inside its folder.
 */
export function farmLayoutAppliesToRoute(
  layoutPattern: string,
  routePattern: string,
  routeDirectory?: string,
): boolean {
  const scope = getFarmLayoutPatternScope(layoutPattern);
  if (scope !== undefined) return farmLayoutScopeContains(scope, routeDirectory);
  return (
    layoutPattern === "/" ||
    routePattern === layoutPattern ||
    routePattern.startsWith(`${layoutPattern}/`)
  );
}
