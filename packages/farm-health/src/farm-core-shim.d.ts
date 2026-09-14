declare module "@farm.js/core/plugin" {
  type MaybePromise<T> = T | Promise<T>;

  interface FarmHealthPluginConfig {
    root?: string;
    basePath?: string;
    plugins?: Array<{ name: string }>;
    server?: {
      health?: false | { livenessPath?: string; readinessPath?: string };
    };
    [key: string]: unknown;
  }

  interface FarmHealthEndpointEvent<TState> {
    request: Request;
    state: TState;
    signal: AbortSignal;
    path: string;
    [key: string]: unknown;
  }

  interface FarmHealthCloseEvent<TState> {
    state: TState;
    reason: string;
    [key: string]: unknown;
  }

  export interface FarmPlugin<TState = unknown> {
    name: string;
    enforce?: "pre" | "post";
    configure?(config: FarmHealthPluginConfig, context: unknown): MaybePromise<unknown>;
    setup?(context: unknown): MaybePromise<TState>;
    runtime?: {
      endpoints?: readonly {
        path: string;
        handler(event: FarmHealthEndpointEvent<TState>): MaybePromise<Response>;
      }[];
      close?(event: FarmHealthCloseEvent<TState>): MaybePromise<void>;
    };
  }

  export function definePlugin<TState>(plugin: FarmPlugin<TState>): FarmPlugin<TState>;
}
