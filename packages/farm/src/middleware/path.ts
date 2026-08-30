export function appendMiddlewareRoutePath(routePath: string, directoryName: string): string {
  if (directoryName.startsWith("(") && directoryName.endsWith(")")) {
    return routePath;
  }

  return routePath === "/" ? `/${directoryName}` : `${routePath}/${directoryName}`;
}
