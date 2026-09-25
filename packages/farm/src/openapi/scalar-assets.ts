export const SCALAR_API_REFERENCE_VERSION = "1.38.1";

const SCALAR_CDN_BASE = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_API_REFERENCE_VERSION}`;

export const SCALAR_API_REFERENCE_SCRIPT = {
  url: `${SCALAR_CDN_BASE}/dist/browser/standalone.js`,
  integrity: "sha384-87uSxO5SeoAG+4aLsnXHJWpb9Gx1biSeaI0O4O5z9OBFe7ZaEJ1LlvVGBo2CkcSO",
} as const;

export const SCALAR_API_REFERENCE_STYLES = {
  url: `${SCALAR_CDN_BASE}/dist/style.css`,
  integrity: "sha384-D1NAbn/NwPaQ5LosRasICtufkVzdUvZZ4+PuXyFYOuR/AzPE0G5BOkXqju29Np+S",
} as const;
