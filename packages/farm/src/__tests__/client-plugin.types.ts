import { expectTypeOf } from "vitest";
import { defineClientPlugin, type FarmClientPlugin } from "../client/plugin";

const inferredPlugin = defineClientPlugin({
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
});

expectTypeOf(inferredPlugin).toMatchTypeOf<
  FarmClientPlugin<{ tracker: { page(pathname: string): number } }>
>();
