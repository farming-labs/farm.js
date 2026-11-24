// The renderer descriptor an app passes to `renderer` in farm.config.ts.

import { defineRenderer } from "@farm.js/core/renderer";

export function leaf() {
  return defineRenderer({
    name: "leaf",
    // Code that runs in the app is named by module id, so each module resolves from the app's own
    // node_modules. routes() and hydration.resolve() below run while Farm scans the app.
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
    // Which files are routes. Farm's folders still work (`about/page.tsx`, `layout.leaf`), and in
    // `guides/` every .leaf file is a page: `harvest.leaf` is /guides/harvest, `index.leaf` is
    // /guides, `_layout.leaf` lays the folder out, other `_` files aren't pages, and `.client`
    // ones hydrate.
    routes({ defaults }) {
      return {
        resolve(file) {
          const folderRoute = defaults.resolve(file);
          if (folderRoute || file.segments[0] !== "guides" || file.extension !== ".leaf") {
            return folderRoute;
          }
          if (file.name === "_layout") return { kind: "layout", pattern: url(file.segments) };
          if (file.name.startsWith("_")) return null;
          const name = file.name.replace(/\.client$/, "");
          return {
            kind: "page",
            pattern: url(name === "index" ? file.segments : [...file.segments, name]),
            ...(name === file.name ? {} : { hydrate: true }),
          };
        },
      };
    },
    hydration: {
      // A .leaf file's own say, in its module script: `// @hydrate` hydrates it, `// @hydrate
      // visible` (or load, idle, interaction) also says when, and `// @hydrate false` keeps it static.
      resolve(source) {
        const pragma = HYDRATE_PRAGMA.exec(source);
        if (!pragma) return undefined;
        if (pragma[1] === "false") return { hydrate: false };
        return pragma[1] ? { hydrate: true, strategy: pragma[1] } : { hydrate: true };
      },
    },
  });
}

const HYDRATE_PRAGMA = /^[ \t]*\/\/[ \t]*@hydrate(?:[ \t]+(load|idle|visible|interaction|false))?[ \t]*$/m;

function url(segments) {
  return `/${segments.join("/")}`;
}
