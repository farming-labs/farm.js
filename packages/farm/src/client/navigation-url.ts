export function isFarmExternalNavigationURL(url: URL, currentOrigin: string): boolean {
  return (url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== currentOrigin;
}
