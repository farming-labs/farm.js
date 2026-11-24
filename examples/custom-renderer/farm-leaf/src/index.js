// The renderer descriptor an app passes to `renderer` in farm.config.ts.

import { defineRenderer } from "@farm.js/core/renderer";

export function leaf() {
  return defineRenderer({
    name: "leaf",
    // Module ids, not functions: farm.config.ts stays serializable and each module resolves
    // from the app's own node_modules.
    vite: "farm-leaf/vite",
    server: "farm-leaf/server",
    client: "farm-leaf/client",
    jsxImportSource: "leaf",
    // `.leaf` files are routes and components next to .tsx; farm-leaf/vite compiles them.
    componentExtensions: [".leaf"],
    capabilities: {
      streaming: { node: false, web: true }, // renderToReadableStream() in farm-leaf/server
      reconcilesRerenders: true, // patching keeps same-position DOM nodes and their state
      functionComponents: true, // components are plain functions
      // After a production hydrateRoot() throws, Farm may render the route with createRoot(): the
      // one in farm-leaf/client empties its container first.
      hydrationFallback: true,
      // farm-leaf/server exports withIsland: with experimental.isolatedClientHydration enabled, a
      // client component rendered from a server page hydrates as its own island.
      islands: true,
    },
  });
}
