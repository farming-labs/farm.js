import { expectTypeOf } from "vitest";
import { defineConfig } from "../config";
import { defineIntegration, type FarmIntegration } from "../integrations";
import {
  definePlugin,
  type FarmPlugin,
  type FarmPluginIntegrationContext,
  type FarmPluginRuntimeSession,
} from "../plugin";

const inferredPlugin = definePlugin({
  name: "typed-runtime",
  setup({ integration }) {
    expectTypeOf(integration).toEqualTypeOf<
      Readonly<FarmPluginIntegrationContext<unknown>> | undefined
    >();
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

defineConfig({ plugins: [inferredPlugin] });

expectTypeOf<FarmPluginRuntimeSession["response"]>().toEqualTypeOf<Response | undefined>();

interface AuthIntegrationInstance {
  auth: {
    api: {
      getSession(input: { headers: Headers }): Promise<{ userId: string } | null>;
    };
  };
}

const authInstance: AuthIntegrationInstance = {
  auth: {
    api: {
      async getSession() {
        return { userId: "user-1" };
      },
    },
  },
};

const authPlugin = definePlugin.forIntegration<AuthIntegrationInstance>()({
  name: "typed-auth",
  runtime: {
    async context({ request, integration }) {
      expectTypeOf(integration).toEqualTypeOf<
        Readonly<FarmPluginIntegrationContext<AuthIntegrationInstance>>
      >();
      expectTypeOf(integration.instance.auth.api.getSession).toBeFunction();
      // @ts-expect-error unknown instance methods must fail type checking
      integration.instance.auth.api.missingMethod();

      return {
        session: await integration.instance.auth.api.getSession({ headers: request.headers }),
      };
    },
  },
});

defineConfig({
  plugins: [
    // @ts-expect-error integration-bound plugins must be contributed by an integration
    authPlugin,
  ],
});

const authIntegration = defineIntegration({
  category: "auth",
  type: "typed-auth",
  instance: authInstance,
  plugins: [authPlugin],
});

expectTypeOf(authIntegration).toMatchTypeOf<
  FarmIntegration<undefined, unknown, AuthIntegrationInstance>
>();

const unknownExplicitIntegration: FarmIntegration = {
  kind: "farm-integration",
  category: "auth",
  type: "unknown-explicit-auth",
  instance: authIntegration.instance,
  plugins: [
    // @ts-expect-error an explicit integration must declare its instance type to accept bound plugins
    authPlugin,
  ],
};

expectTypeOf(unknownExplicitIntegration.instance).toEqualTypeOf<unknown>();

const incompatibleExplicitIntegration: FarmIntegration<
  undefined,
  unknown,
  { auth: { enabled: boolean } }
> = {
  kind: "farm-integration",
  category: "auth",
  type: "incompatible-explicit-auth",
  instance: { auth: { enabled: true } },
  plugins: [
    // @ts-expect-error explicitly typed integrations reject plugins requiring another instance
    authPlugin,
  ],
};

expectTypeOf(incompatibleExplicitIntegration.instance.auth.enabled).toEqualTypeOf<boolean>();

defineIntegration({
  category: "auth",
  type: "wrong-auth-instance",
  instance: { auth: { enabled: true } },
  plugins: [
    // @ts-expect-error the plugin requires an auth instance with api.getSession
    authPlugin,
  ],
});
