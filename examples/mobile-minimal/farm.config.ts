import { defineConfig } from "@farm.js/core";

export default defineConfig({
  // Only `farm dev|build --mobile` and `farm config inspect --mobile` read this block. A web
  // build strips it, like `desktop`.
  mobile: ({ command }) => ({
    name: "Trail Guide",
    id: "dev.farmjs.examples.trailguide",
    // The web deployment the app loads pages from. `farm dev --mobile` uses the dev server.
    server:
      command === "dev"
        ? undefined
        : (process.env.TRAIL_GUIDE_SERVER ?? "https://trail-guide.farmjs.dev"),
    tabs: [
      { path: "/", title: "Trails", icon: "house" },
      { path: "/about", title: "About", icon: "info.circle" },
    ],
    // The whole point of this example: no native code, no page.native.tsx, no React Native.
    // The analyzer reads each page; the ones it proves portable become `server` screens, drawn
    // with native views from the page the server renders.
    native: { auto: "on" },
  }),
});
