/**
 * Whether a Nitro preset deploys the server to Cloudflare Workers, where there's no
 * `node_modules` to load packages from at runtime, so the RSC and SSR bundles must include them.
 */
export function isRscWorkersPreset(preset: string | undefined): boolean {
  return preset === "cloudflare" || preset === "cloudflare-pages" || preset === "cloudflare-module";
}
