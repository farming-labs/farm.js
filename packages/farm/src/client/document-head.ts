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

/**
 * Keep the head tags a server rendered from route metadata in step with client navigation when
 * React renders the page's own elements (the RSC router), so React's nodes in `<head>` stay where
 * React put them. Only the nodes Farm inserted are replaced: on creation, the ones of
 * `initialMarkup` (the markup the server injected for the page the document loaded with), then
 * the ones each call inserts. The tag set is the one `reconcileFarmDocumentHead` swaps; the title
 * is left to the router.
 */
export function createFarmMetadataHeadReconciler(initialMarkup: string): (markup: string) => void {
  const candidates = Array.from(
    document.head.querySelectorAll(FARM_NAVIGATION_HEAD_SELECTOR),
  ).reverse();
  const claimed = new Set<Element>();
  for (const node of parseFarmHeadMarkup(initialMarkup)) {
    // The server injects its markup at the end of <head>, so search from the end.
    const match = candidates.find(
      (candidate) => !claimed.has(candidate) && candidate.isEqualNode(node),
    );
    if (match) claimed.add(match);
  }
  let current = initialMarkup;
  let owned = Array.from(claimed);
  return (markup) => {
    if (markup === current) return;
    current = markup;
    for (const node of owned) node.remove();
    owned = parseFarmHeadMarkup(markup).map((node) =>
      document.head.appendChild(document.importNode(node, true)),
    );
  };
}

function parseFarmHeadMarkup(markup: string): Element[] {
  if (!markup) return [];
  const template = document.createElement("template");
  template.innerHTML = markup;
  return Array.from(template.content.querySelectorAll(FARM_NAVIGATION_HEAD_SELECTOR));
}
