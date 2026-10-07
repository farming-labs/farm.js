export const FARM_NAVIGATION_HEAD_SELECTOR = [
  "meta[name]",
  "meta[property]",
  "meta[http-equiv]",
  "meta[charset]",
  "meta[itemprop]",
  'link[rel~="author"]',
  'link[rel~="canonical"]',
  'link[rel~="alternate"]',
  'link[rel~="icon"]',
  'link[rel~="apple-touch-icon"]',
  'link[rel~="manifest"]',
  'link[rel~="search"]',
  'link[rel~="next"]',
  'link[rel~="prev"]',
  'link[rel~="publisher"]',
  'link[rel~="license"]',
  'link[rel~="help"]',
  'link[rel~="me"]',
  'link[rel~="pingback"]',
  'link[rel~="privacy-policy"]',
  'link[rel~="terms-of-service"]',
  // Page and layout `metadata.jsonLd` (FARM_METADATA_ATTRIBUTE). The site-level
  // agent JSON-LD and app-authored scripts carry no marker and stay in place.
  'script[type="application/ld+json"][data-farm-metadata]',
].join(",");

export function reconcileFarmDocumentHead(nextDocument: Document): void {
  const nextTitle = nextDocument.querySelector("title");
  document.title = nextTitle?.textContent || "";

  document.head.querySelectorAll(FARM_NAVIGATION_HEAD_SELECTOR).forEach((node) => node.remove());
  nextDocument.head
    .querySelectorAll(FARM_NAVIGATION_HEAD_SELECTOR)
    .forEach((node) => document.head.appendChild(document.importNode(node, true)));
}
