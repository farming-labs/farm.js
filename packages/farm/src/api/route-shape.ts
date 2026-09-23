import {
  AmbiguousRouteError,
  assertUniqueRouteParameters,
  getRoutePatternShape,
} from "../routing/specificity";

export interface APIRouteShapeSource<TSource> {
  routePath: string;
  source: TSource;
  filePath: string;
}

/** Validate API URL shapes and return the lower-priority route replaced by this source. */
export function registerAPIRouteShape<TSource>(
  shapes: Map<string, APIRouteShapeSource<TSource>>,
  routePath: string,
  filePath: string,
  source: TSource,
): string | undefined {
  assertUniqueRouteParameters(routePath, "api");
  const shape = getRoutePatternShape(routePath, "api");
  const existing = shapes.get(shape);
  const replacesPath = existing && existing.routePath !== routePath;

  if (replacesPath && existing.source === source) {
    throw new AmbiguousRouteError(
      `Ambiguous API routes "${existing.routePath}" and "${routePath}" match the same URLs. Found ${existing.filePath} and ${filePath}. Keep only one route for this URL shape.`,
    );
  }

  shapes.set(shape, { routePath, source, filePath });
  return replacesPath ? existing.routePath : undefined;
}
