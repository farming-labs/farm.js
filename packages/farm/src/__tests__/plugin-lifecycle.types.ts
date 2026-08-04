import { expectTypeOf } from "vitest";
import { defineIntegration } from "../integrations";
import { definePlugin, type FarmPlugin, type FarmPluginRuntimeSession } from "../plugin";

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

expectTypeOf<FarmPluginRuntimeSession["response"]>().toEqualTypeOf<Response | undefined>();

interface AuthIntegrationInstance {
  auth: {
    api: {
      getSession(input: { headers: Headers }): Promise<{ userId: string } | null>;
    };
  };
}

const authPlugin = definePlugin.forIntegration<AuthIntegrationInstance>()({
  name: "typed-auth",
  runtime: {
    async context({ request, integration }) {
      if (!integration) return {};

      expectTypeOf(integration.instance.auth.api.getSession).toBeFunction();
      // @ts-expect-error unknown instance methods must fail type checking
      integration.instance.auth.api.missingMethod();

      return {
        session: await integration.instance.auth.api.getSession({ headers: request.headers }),
      };
    },
  },
});

defineIntegration({
  category: "auth",
  type: "typed-auth",
  instance: {
    auth: {
      api: {
        async getSession() {
          return { userId: "user-1" };
        },
      },
    },
  },
  plugins: [authPlugin],
});

defineIntegration({
  category: "auth",
  type: "wrong-auth-instance",
  instance: { auth: { enabled: true } },
  plugins: [
    // @ts-expect-error the plugin requires an auth instance with api.getSession
    authPlugin,
  ],
});
