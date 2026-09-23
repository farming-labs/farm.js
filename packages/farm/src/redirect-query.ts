/** Preserve an incoming query when a redirect destination does not declare one. */
export function appendFarmRedirectQuery(destination: string, search: string): string {
  if (!search || search === "?") return destination;

  const hashIndex = destination.indexOf("#");
  const pathAndQuery = hashIndex === -1 ? destination : destination.slice(0, hashIndex);
  if (pathAndQuery.includes("?")) return destination;

  if (hashIndex === -1) return `${destination}${search}`;
  return `${pathAndQuery}${search}${destination.slice(hashIndex)}`;
}
