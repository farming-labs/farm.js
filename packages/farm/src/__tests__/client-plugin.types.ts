import { expectTypeOf } from "vitest";
import { definePlugin, type FarmPluginClientConfig } from "../plugin";

const inferredPlugin = definePlugin({
  name: "inferred-client-state",
  client: {
    setup() {
      return {
        tracker: {
          page(pathname: string) {
            return pathname.length;
          },
        },
      };
    },
    hydration: {
      after({ state, durationMs, recovered }) {
        expectTypeOf(state.tracker.page).parameter(0).toEqualTypeOf<string>();
        expectTypeOf(durationMs).toEqualTypeOf<number>();
        expectTypeOf(recovered).toEqualTypeOf<boolean>();
      },
    },
    navigation: {
      before({ state, to, action, signal }) {
        expectTypeOf(state.tracker.page(to.pathname)).toEqualTypeOf<number>();
        expectTypeOf(action).toEqualTypeOf<"push" | "replace" | "pop">();
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
      },
    },
  },
});

expectTypeOf(inferredPlugin.client).toMatchTypeOf<
  FarmPluginClientConfig<{ tracker: { page(pathname: string): number } }, undefined> | undefined
>();

const publicPlugin = definePlugin({
  name: "typed-client-public-data",
  client: {
    public: {
      projectId: "storefront",
      sampleRate: 0.25,
    },
    setup({ public: config }) {
      expectTypeOf(config.projectId).toEqualTypeOf<string>();
      expectTypeOf(config.sampleRate).toEqualTypeOf<number>();
      return { initialized: true };
    },
    navigation: {
      rendered({ public: config, state }) {
        expectTypeOf(config.projectId).toEqualTypeOf<string>();
        expectTypeOf(state.initialized).toEqualTypeOf<boolean>();
      },
    },
  },
});

expectTypeOf(publicPlugin.client).toMatchTypeOf<
  | FarmPluginClientConfig<{ initialized: boolean }, { projectId: string; sampleRate: number }>
  | undefined
>();
