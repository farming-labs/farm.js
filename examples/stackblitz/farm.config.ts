import { defineConfig } from "@farm.js/core";
import { react } from "@farm.js/react";

export default defineConfig({
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
  // Components that opt in with a "use compiler" directive are compiled ahead
  // of time into direct DOM updates; everything else keeps the normal React
  // path. See src/components/counter.tsx for the opt-in.
  renderer: react({
    experimental: {
      compiler: {
        mode: "annotation",
        onUnsupported: "warn",
      },
    },
  }),
  experimental: {
    serverComponents: true,
    serverActions: true,
  },
});
