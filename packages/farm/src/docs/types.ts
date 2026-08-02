import type { DocsConfig } from "@farming-labs/docs";

export interface FarmDocsSidebarItem {
  label?: string;
  title?: string;
  slug?: string;
  href?: string;
  icon?: string;
  children?: FarmDocsSidebarItem[];
  items?: FarmDocsSidebarItem[];
}

export interface FarmDocsNavigationConfig {
  sidebar?: FarmDocsSidebarItem[];
}

export interface FarmDocsSocialImageConfig {
  /** Generate a page-specific 1200×630 social image. Defaults to true. */
  enabled?: boolean;
  /** Absolute public origin used in social metadata, e.g. https://example.com. */
  baseUrl?: string;
  /** Site name shown in Open Graph metadata. Defaults to the docs navigation title. */
  siteName?: string;
  /** Short brand label drawn in the image header. Defaults to siteName. */
  brand?: string;
  /** Optional WOFF2 URLs or data URLs embedded into the generated SVG. */
  fonts?: FarmDocsSocialImageFonts;
}

export interface FarmDocsSocialImageFonts {
  /** Display face used for page titles. */
  display?: string;
  /** Sans-serif face used for descriptions. */
  sans?: string;
  /** Monospace face used for labels, routes, and diagrams. */
  mono?: string;
}

export type FarmDocsRuntimeConfig = Partial<DocsConfig> & {
  /**
   * Public favicon URL used by the standalone docs renderer.
   * Set this explicitly when docs should share the host application's icon.
   */
  favicon?: string;
  /**
   * Optional serializable navigation tree used by Farm's docs runtime.
   * Icon values reference keys from `icons`.
   */
  navigation?: FarmDocsNavigationConfig;
  /**
   * Automatic page-specific Open Graph and X images for Markdown docs.
   * Enabled by default. Set false to opt out for the complete docs tree.
   */
  socialImage?: boolean | FarmDocsSocialImageConfig;
};

export type FarmDocsConfigInput = FarmDocsRuntimeConfig & {
  /**
   * Farm public route for docs, e.g. "/docs". When passed through
   * `config`, this is converted to the docs package's folder-style `entry`.
   */
  entry?: string;
  /** Explicit public route prefix. Defaults to `entry`. */
  docsPath?: string;
  /** Source content directory, relative to the project root. */
  contentDir?: string;
  /** Set to false to opt out even when a docs config file exists. */
  enabled?: boolean;
  /** Inline @farming-labs/docs config object. */
  config?: FarmDocsRuntimeConfig;
  /** Path to docs.config.* or docs.json. */
  configPath?: string;
};

export type FarmDocsUserConfig = boolean | FarmDocsConfigInput;

export interface FarmDocsResolvedConfig {
  enabled: boolean;
  entry: string;
  contentDir?: string;
  configPath?: string;
  config: FarmDocsRuntimeConfig & Pick<DocsConfig, "entry">;
}
