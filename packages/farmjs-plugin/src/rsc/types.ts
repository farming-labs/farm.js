/**
 * Configuration options for the Farm.js RSC plugin.
 */
export interface FarmRscPluginOptions {
  /**
   * Override the auto-generated virtual entries with custom files.
   * If not provided, virtual entries are generated automatically based on
   * the user's project structure.
   */
  entries?: {
    /** Custom RSC environment entry file */
    rsc?: string;
    /** Custom SSR environment entry file */
    ssr?: string;
    /** Custom client environment entry file */
    client?: string;
  };

  /**
   * Enable encryption for server action bound arguments.
   * This prevents exposing sensitive closure data in the client bundle.
   * @default true
   */
  encryptActions?: boolean;

  /**
   * Subdirectory within srcDir containing route files.
   * If empty, routes are discovered directly in srcDir.
   * @default ''
   */
  routesDir?: string;

  /**
   * Custom CSS injection function.
   * If not provided, uses import.meta.viteRsc.loadCss().
   */
  cssLoader?: string;

  /**
   * Enable verbose logging for debugging.
   * @default false
   */
  debug?: boolean;
}

/**
 * Internal context passed to entry generators.
 * Contains resolved configuration values needed to generate entry files.
 */
export interface EntryContext {
  /** User's source directory, e.g. 'src' */
  srcDir: string;

  /** Build output directory, e.g. 'dist' */
  outDir: string;

  /** Base URL path, e.g. '/' */
  basePath: string;

  /** Route files subdirectory within srcDir */
  routesDir: string;

  /** Whether server actions are enabled */
  actionsEnabled: boolean;

  /** Whether debug mode is enabled */
  debug: boolean;
}

/**
 * Matched route information from the file-based router.
 */
export interface MatchedRoute {
  /** The page component's default export */
  Page: React.ComponentType<any>;

  /** The file pattern that matched, e.g. '/src/about/page.tsx' */
  pattern: string;

  /** Dynamic route parameters, e.g. { slug: 'my-post' } */
  params: Record<string, string>;
}

/**
 * RSC payload structure sent from server to client.
 */
export interface RscPayload {
  /** The root React element tree (full document for SSR) */
  root: React.ReactElement;

  /** Content for div#root only (for client hydration to avoid double/repeated content) */
  rootContent?: React.ReactElement;

  /** Server action return value (if action was executed) */
  returnValue?: {
    ok: boolean;
    data: unknown;
  };

  /** Form state for progressive enhancement */
  formState?: unknown;
}

/**
 * Vite RSC module augmentation for import.meta.
 */
declare global {
  interface ImportMeta {
    readonly viteRsc: {
      /** Load CSS for server components */
      loadCss(): React.ReactElement[];

      /** Load a module from another environment */
      loadModule<T = unknown>(env: string, entry: string): Promise<T>;

      /** Load bootstrap script content for hydration */
      loadBootstrapScriptContent(entry: string): Promise<string>;
    };
  }
}
