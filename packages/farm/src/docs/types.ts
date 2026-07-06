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

export type FarmDocsRuntimeConfig = Partial<DocsConfig> & {
  /**
   * Optional serializable navigation tree used by Farm's docs runtime.
   * Icon values reference keys from `icons`.
   */
  navigation?: FarmDocsNavigationConfig;
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
