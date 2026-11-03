import type { DocsConfig } from "@farming-labs/docs";

export interface FarmDocsAdapterDescriptor {
  id: string;
  protocol: number;
  server: string;
  react?: string;
  vite?: string;
  /**
   * Build-time entry that compiles the adapter's docs runtime into Farm's
   * serializable edge manifest. Older Farm releases safely ignore it.
   */
  edgeCompiler?: string;
}

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
   * Versioned runtime descriptor supplied by an external docs adapter.
   * Set false to pin the embedded renderer and disable framework
   * auto-detection.
   */
  adapter?: FarmDocsAdapterDescriptor | false;
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
  /**
   * Render every page of a docs adapter during `farm build` and serve it as a
   * static file on Node and serverless targets. A static page does not
   * negotiate `Accept: text/markdown`; agents use the `.md` URL it links to.
   * Markdown, search, `llms.txt`, and MCP stay server-rendered.
   */
  prerender?: boolean;
  /** Inline @farming-labs/docs config object. */
  config?: FarmDocsRuntimeConfig;
  /** Path to docs.config.* or docs.json. */
  configPath?: string;
  /**
   * Additional docs sets served next to this one, each under its own route. Each root
   * inherits this config and applies its own `config` over it. Requires a docs adapter.
   */
  roots?: FarmDocsRootInput[];
};

export interface FarmDocsRootInput {
  /** Public route of this docs set, e.g. "/statewire/docs". */
  entry: string;
  /** Source content directory, relative to the project root. Defaults to `src/app/<entry>`. */
  contentDir?: string;
  /** Serializable settings applied over the main docs config for this root. */
  config?: FarmDocsRuntimeConfig;
}

export type FarmDocsUserConfig = boolean | FarmDocsConfigInput;

export interface FarmDocsResolvedConfig {
  enabled: boolean;
  entry: string;
  adapter?: FarmDocsAdapterDescriptor;
  /** `docs.prerender` from `farm.config.ts`. */
  prerender?: boolean;
  contentDir?: string;
  configPath?: string;
  config: FarmDocsRuntimeConfig & Pick<DocsConfig, "entry">;
  /**
   * `config` before it was made serializable: icons and other React elements, MDX
   * components, and callbacks intact. Only the in-process adapter runtime reads it;
   * whatever Farm serializes uses `config`.
   */
  runtimeConfig?: FarmDocsRuntimeConfig & Pick<DocsConfig, "entry">;
  /** The serializable docs settings from `farm.config.ts`, applied over the config file. */
  configOverrides?: Partial<DocsConfig>;
  /** The resolved `docs.roots`, served alongside this root. Absent with a single root. */
  roots?: FarmDocsResolvedRoot[];
}

export type FarmDocsResolvedRoot = Pick<
  FarmDocsResolvedConfig,
  "entry" | "contentDir" | "config" | "runtimeConfig" | "configOverrides"
>;
