import type React from "react";

export type FarmMdxComponent = React.ComponentType<any> | keyof React.JSX.IntrinsicElements;
export type FarmMdxComponents = Record<string, FarmMdxComponent>;

export interface FarmMdxUserConfig {
  /**
   * Component map or module path that exports `components` or a default component map.
   * Relative paths resolve from the project root.
   */
  components?: string | FarmMdxComponents;
  /**
   * Serve source-authored markdown pages at `/route.md`.
   * Enabled by default for `page.md` and `page.mdx`.
   */
  markdownRoutes?: boolean;
  /** Class name used for the wrapper around rendered markdown content. */
  className?: string;
}

export interface FarmMdxResolvedConfig {
  components?: string | FarmMdxComponents;
  markdownRoutes: boolean;
  className: string;
}

export function resolveMdxConfig(config: FarmMdxUserConfig | undefined): FarmMdxResolvedConfig {
  return {
    components: config?.components,
    markdownRoutes: config?.markdownRoutes ?? true,
    className: config?.className ?? "farm-markdown",
  };
}
