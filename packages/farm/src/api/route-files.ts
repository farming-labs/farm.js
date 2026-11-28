/** The experimental Rust, Go, and Python conventions are active only where Vite loaded Polyroute. */
export function hasPolyroutePlugin(plugins?: readonly { name: string }[]): boolean {
  return plugins?.some((plugin) => plugin.name === "polyroute") === true;
}

/**
 * Route entries Polyroute compiles. A Go route's other files and `go.mod`, and
 * the Python modules a `route.py` imports, are not entries.
 */
export function isPolyrouteRouteFileName(fileName: string): boolean {
  return fileName === "route.rs" || fileName === "route.go" || fileName === "route.py";
}

export function isFarmAPIRouteFileName(fileName: string, polyroute = false): boolean {
  if (polyroute && isPolyrouteRouteFileName(fileName)) return true;
  return /^route\.(?:ts|tsx|js|jsx)$/.test(fileName);
}
