declare module "@farm.js/core/plugin" {
  export interface FarmPlugin<
    TState = unknown,
    TRequestContext extends object = Record<string, unknown>,
    TClientState = unknown,
    TClientPublic = undefined,
  > {
    name: string;
    enforce?: "pre" | "post";
    configure?(config: {
      plugins?: FarmPlugin[];
      [key: string]: unknown;
    }): unknown | Promise<unknown>;
    client?: {
      public?: TClientPublic;
      setup?(event: { public: Readonly<TClientPublic> }): TClientState | Promise<TClientState>;
      hydration?: {
        after?(event: { state: TClientState }): void | Promise<void>;
      };
      navigation?: {
        rendered?(event: { state: TClientState }): void | Promise<void>;
      };
      close?(event: { state: TClientState }): void | Promise<void>;
    };
    readonly __requestContext?: TRequestContext;
    readonly __state?: TState;
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
