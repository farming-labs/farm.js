import { expectTypeOf } from "vitest";
import { definePlugin, type FarmPlugin } from "../plugin";

const inferredPlugin = definePlugin({
  name: "typed-runtime",
  setup() {
    return {
      tracer: {
        start(pathname: string) {
          return { id: `trace:${pathname}` };
        },
      },
    };
  },
  runtime: {
    context({ request, state }) {
      expectTypeOf(state.tracer.start).parameter(0).toEqualTypeOf<string>();
      return {
        trace: state.tracer.start(new URL(request.url).pathname),
      };
    },
    before({ ctx }) {
      expectTypeOf(ctx.trace.id).toEqualTypeOf<string>();
    },
    after({ ctx, response }) {
      expectTypeOf(ctx.trace.id).toEqualTypeOf<string>();
      return response;
    },
  },
});

expectTypeOf(inferredPlugin).toMatchTypeOf<
  FarmPlugin<{ tracer: { start(pathname: string): { id: string } } }, { trace: { id: string } }>
>();
