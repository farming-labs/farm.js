declare module "@farm.js/core/plugin" {
  export interface FarmPluginContext {
    config: FarmConfig;
    isDev: boolean;
    isProd: boolean;
  }

  export interface FarmConfig {
    root?: string;
    basePath?: string;
    plugins?: FarmPlugin[];
    vite?: { plugins?: unknown[]; [key: string]: unknown };
    [key: string]: unknown;
  }

  export interface FarmPlugin {
    name: string;
    enforce?: "pre" | "post";
    configure?(config: FarmConfig, context: FarmPluginContext): FarmConfig | void;
    render?: {
      html?(
        html: string,
        render: { pathname: string; [key: string]: unknown },
        context: FarmPluginContext,
      ): string | void | Promise<string | void>;
    };
    build?: {
      configure?(buildConfig: any, context: FarmPluginContext): any | Promise<any>;
    };
  }

  export function definePlugin(plugin: FarmPlugin): FarmPlugin;
}
