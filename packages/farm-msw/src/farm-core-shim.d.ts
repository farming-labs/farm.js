declare module "@farm.js/core/plugin" {
  export interface FarmPluginClientConfig<TState = unknown, TPublic = undefined> {
    public?: TPublic;
    setup?(event: {
      public: Readonly<TPublic>;
      isDev: boolean;
      isProd: boolean;
    }): TState | Promise<TState>;
    close?(event: { state: TState }): void | Promise<void>;
  }

  export interface FarmPlugin<
    TState = unknown,
    TRequestContext extends object = Record<string, unknown>,
    TClientState = unknown,
    TClientPublic = undefined,
  > {
    name: string;
    enforce?: "pre" | "post";
    configure?(
      config: {
        root?: string;
        basePath?: string;
        plugins?: FarmPlugin[];
        vite?: { plugins?: unknown[]; [key: string]: unknown };
        [key: string]: unknown;
      },
      context: { isDev: boolean; isProd: boolean },
    ): unknown | Promise<unknown>;
    setup?(context: unknown): TState | Promise<TState>;
    dev?: {
      server?(viteServer: unknown, context: { state: TState }): void | Promise<void>;
      update?(
        update: { file: string; modules: string[] },
        context: { state: TState },
      ): void | Promise<void>;
    };
    runtime?: {
      close?(context: { state: TState; reason?: string }): void | Promise<void>;
    };
    client?: FarmPluginClientConfig<TClientState, TClientPublic>;
    readonly __requestContext?: TRequestContext;
  }

  export function definePlugin<
    TState = unknown,
    TRequestContext extends object = Record<string, unknown>,
    TClientState = unknown,
    TClientPublic = undefined,
  >(
    plugin: FarmPlugin<TState, TRequestContext, TClientState, TClientPublic>,
  ): FarmPlugin<TState, TRequestContext, TClientState, TClientPublic>;
}
