/** The experimental Rust convention is active only where Vite loaded Polyroute. */
export function hasPolyroutePlugin(plugins?: readonly { name: string }[]): boolean {
  return plugins?.some((plugin) => plugin.name === "polyroute") === true;
}

export function isFarmAPIRouteFileName(fileName: string, polyroute = false): boolean {
  if (polyroute && fileName === "route.rs") return true;
  return /^route\.(?:ts|tsx|js|jsx)$/.test(fileName);
}
