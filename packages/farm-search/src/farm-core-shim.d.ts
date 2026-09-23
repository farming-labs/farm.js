declare module "@farm.js/core/plugin" {
  export interface FarmPlugin {
    name: string;
    enforce?: "pre" | "post";
    configure?(config: {
      root?: string;
      basePath?: string;
      plugins?: FarmPlugin[];
      [key: string]: unknown;
    }): unknown | Promise<unknown>;
    build?: {
      before?(): void | Promise<void>;
      configure?(buildConfig: any): any | Promise<any>;
      after?(result: {
        root: string;
        preset: string;
        outputDir?: string;
        success: boolean;
      }): void | Promise<void>;
    };
    client?: {
      public?: unknown;
      setup?(event: { public: any; isDev: boolean; isProd: boolean }): unknown | Promise<unknown>;
    };
  }

  export function definePlugin(plugin: FarmPlugin): FarmPlugin;
}
