import { defineRendererClientConformance } from "@farm.js/renderer-tests";
import * as clientRuntime from "../client";

interface SolidHydrationBootstrap {
  events: unknown[];
  completed: WeakSet<object>;
  r: Record<string, unknown>;
  fe(): void;
}

declare global {
  // eslint-disable-next-line no-var
  var _$HY: SolidHydrationBootstrap | undefined;
}

defineRendererClientConformance({
  name: "solid",
  client: clientRuntime,
  server: {
    createElement: clientRuntime.createElement,
    renderToString: async () => '<button data-hk="00">Hydrated content</button>',
  },
  hydrationHtml: async () => '<button data-hk="00">Hydrated content</button>',
  beforeHydrate() {
    const bootstrap: SolidHydrationBootstrap = {
      events: [],
      completed: new WeakSet(),
      r: {},
      fe() {},
    };
    globalThis._$HY = bootstrap;
    Object.assign(window, { _$HY: bootstrap });
  },
});
