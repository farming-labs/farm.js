declare module "@farm.js/core/plugin" {
  export interface FarmConfig {
    root?: string;
    plugins?: FarmPlugin[];
    vite?: {
      plugins?: unknown[];
      optimizeDeps?: { exclude?: string[]; [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  }

  export interface FarmPluginContext {
    config: FarmConfig;
    isDev: boolean;
    isProd: boolean;
  }

  export interface FarmPlugin {
    name: string;
    enforce?: "pre" | "post";
    configure?(
      config: FarmConfig,
      context: FarmPluginContext,
    ): FarmConfig | void | Promise<FarmConfig | void>;
  }

  export function definePlugin(plugin: FarmPlugin): FarmPlugin;
}
