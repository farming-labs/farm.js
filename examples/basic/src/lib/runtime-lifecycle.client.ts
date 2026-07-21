import { defineClientPlugin } from '@farmjs/core/plugin/client';

interface RuntimeLifecycleOptions {
  label: string;
}

interface RuntimeLifecycleState {
  events: string[];
}

declare global {
  interface Window {
    __FARM_CLIENT_PLUGIN_EVENTS__?: string[];
  }
}

function record(state: RuntimeLifecycleState, event: string) {
  state.events.push(event);
  window.__FARM_CLIENT_PLUGIN_EVENTS__ = [...state.events];
  document.documentElement.dataset.farmClientPluginEvent = event;
  window.dispatchEvent(new CustomEvent('farm:client-plugin-event', { detail: event }));
}

export default function runtimeLifecycleClient(options: Readonly<RuntimeLifecycleOptions>) {
  return defineClientPlugin<RuntimeLifecycleState, RuntimeLifecycleOptions>({
    setup({ plugin, isDev }) {
      const state = { events: [] };
      document.documentElement.dataset.farmClientPlugin = options.label;
      record(state, `setup:${plugin.name}:${options.label}:${isDev ? 'dev' : 'prod'}`);
      return state;
    },

    hydration: {
      before({ state, mode }) {
        record(state, `hydration:before:${mode}`);
      },
      after({ state, recovered }) {
        record(state, `hydration:after:${recovered ? 'recovered' : 'ready'}`);
      },
    },

    navigation: {
      before({ state, to }) {
        record(state, `navigation:before:${to.pathname}`);
      },
      loaded({ state, to }) {
        record(state, `navigation:loaded:${to.pathname}`);
      },
      resolved({ state, to }) {
        record(state, `navigation:resolved:${to.pathname}`);
      },
      rendered({ state, to }) {
        record(state, `navigation:rendered:${to.pathname}`);
      },
      error({ state, to }) {
        record(state, `navigation:error:${to.pathname}`);
      },
    },

    error({ state, phase }) {
      record(state, `error:${phase}`);
    },

    close({ state, reason }) {
      record(state, `close:${reason}`);
    },
  });
}
