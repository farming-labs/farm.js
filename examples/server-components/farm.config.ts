import { defineConfig, definePlugin } from "@farm.js/core";

// One app, either server components engine. The contract suite builds it once per mode
// (tests/e2e-server-components) and runs the same browser tests against both.
const mode = process.env.FARM_SERVER_COMPONENTS_MODE === "islands" ? "islands" : "rsc";
// A deploy target to build for instead of the Node server the contract runs by default.
const target = process.env.FARM_SERVER_COMPONENTS_TARGET;

// Records the client plugin hooks the browser entry runs (client-plugins.spec.ts). The rsc build
// has it. An islands build has it only with FARM_SERVER_COMPONENTS_CLIENT_PLUGINS=1: there a client
// plugin loads the client runtime on every page, and the contract checks that pages without
// islands load none.
const clientPlugins = mode === "rsc" || process.env.FARM_SERVER_COMPONENTS_CLIENT_PLUGINS === "1";
const clientLifecycle = definePlugin({
  name: "contract:client-lifecycle",
  client: {
    public: { label: "contract" },
    setup({ public: config, isDev, router }) {
      const events: string[] = [];
      const record = (event: string) => {
        events.push(event);
        Object.assign(window, { __FARM_CLIENT_PLUGIN_EVENTS__: [...events] });
      };
      Object.assign(window, { __FARM_CLIENT_PLUGIN_ROUTER__: router });
      record(`setup:${config.label}:${isDev ? "dev" : "prod"}`);
      return { record };
    },
    hydration: {
      before({ state, mode }) {
        state.record(`hydration:before:${mode}`);
      },
      after({ state }) {
        state.record("hydration:after");
      },
    },
    navigation: {
      before({ state, action, to }) {
        state.record(`navigation:before:${action}:${to.pathname}`);
      },
      loaded({ state, to }) {
        state.record(`navigation:loaded:${to.pathname}`);
      },
      // The page on screen when the hook runs: React has committed the navigation.
      resolved({ state, to }) {
        state.record(`navigation:resolved:${to.pathname}:${document.querySelector("h1")?.textContent}`);
      },
      rendered({ state, to }) {
        state.record(`navigation:rendered:${to.pathname}`);
      },
      error({ state, to }) {
        state.record(`navigation:error:${to.pathname}`);
      },
    },
  },
});

export default defineConfig({
  // The mobile contract (RFC 0004): `farm build --mobile` adds native-tier screens, such as
  // /native, which posts its server actions from native views. A web build strips this block.
  mobile: {
    id: "dev.farmjs.examples.servercomponents",
    // CI points the APK at this app's own production server (the Mobile Android workflow).
    server: process.env.FARM_SERVER_COMPONENTS_MOBILE_SERVER ?? "https://server-components.farmjs.dev",
  },
  experimental: {
    serverComponents: { mode },
    serverActions: true,
  },
  plugins: clientPlugins ? [clientLifecycle] : [],
  deploy: {
    ...(target ? { target } : {}),
    outputDir: `.farm/.output-${mode}${target ? `-${target}` : ""}${mode === "islands" && clientPlugins ? "-plugins" : ""}`,
  },
});
