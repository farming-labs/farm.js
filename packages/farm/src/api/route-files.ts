export function isFarmAPIRouteFileName(fileName: string): boolean {
  return /^route\.(?:ts|tsx|js|jsx)$/.test(fileName);
}
