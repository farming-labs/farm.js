import { FARM_METADATA_ATTRIBUTE, renderMetadataHead, resolveMetadataTitle } from "../metadata";
import type { Metadata } from "../types";

export type NavigationMetadata = (Metadata & Record<string, any>) | undefined;

/** Marks head elements this reconciler inserted, so they can be replaced. */
const MANAGED_ATTRIBUTE = FARM_METADATA_ATTRIBUTE;

/**
 * Head tags the metadata system owns outright. These are swept on every
 * navigation whether or not they carry the managed marker, because the tags
 * rendered by the server for the first page have no marker and must not
 * survive into the next page's head.
 */
const OWNED_SELECTORS = [
  'meta[name="description"]',
  'meta[name="keywords"]',
  'meta[name="author"]',
  'meta[name="creator"]',
  'meta[name="publisher"]',
  'meta[name="robots"]',
  'link[rel="author"]',
  'link[rel="canonical"]',
  'link[rel="alternate"]',
  'meta[property^="og:"]',
  'meta[name^="twitter:"]',
].join(", ");

/**
 * Icons and the web-app manifest have document-level defaults that exist
 * outside page metadata (the default favicon, a discovered manifest route), so
 * an absent value means "keep what the document has", not "remove it". They
 * are only swept when the next page defines its own.
 */
const ICON_SELECTORS = [
  'link[rel="icon"]',
  'link[rel="shortcut icon"]',
  'link[rel="apple-touch-icon"]',
].join(", ");
const MANIFEST_SELECTOR = 'link[rel="manifest"]';
const PAGE_JSON_LD_SELECTOR = `script[type="application/ld+json"][${MANAGED_ATTRIBUTE}]`;

function removeAll(selector: string): void {
  for (const element of Array.from(document.head.querySelectorAll(selector))) {
    element.remove();
  }
}

/**
 * Make the document head for a client-side navigation match what a full-page
 * load of the target route renders: same title resolution and the same managed
 * tag set, produced by the same `renderMetadataHead` the server uses.
 *
 * Only page and layout JSON-LD (`metadata.jsonLd`) is swapped, matched by its
 * marker. The agent JSON-LD script is site identity rather than page metadata,
 * and ld+json scripts the application authored itself carry no marker, so
 * both stay untouched.
 */
export function applyFarmMetadataToDocument(metadata: NavigationMetadata, pathname: string): void {
  document.title = resolveMetadataTitle(metadata?.title) || "Farm.js App";

  const rendered = renderMetadataHead(metadata, { pathname });
  const template = document.createElement("template");
  template.innerHTML = rendered.tags;

  removeAll(OWNED_SELECTORS);
  removeAll(PAGE_JSON_LD_SELECTOR);
  if (metadata?.icons) removeAll(ICON_SELECTORS);
  if (metadata?.manifest) removeAll(MANIFEST_SELECTOR);

  for (const element of Array.from(template.content.children)) {
    element.setAttribute(MANAGED_ATTRIBUTE, "");
    document.head.appendChild(element);
  }
}
