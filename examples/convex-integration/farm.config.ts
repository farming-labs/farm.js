import { defineConfig } from "@farm.js/core";
import { convex, convexStorage } from "@farm.js/convex";

export default defineConfig({
  experimental: {
    serverComponents: true,
  },
  integrations: {
    // Better Auth is detected from convex/convex.config.ts.
    convex: convex(),
  },
  storage: {
    mounts: {
      notes: convexStorage({ namespace: "notes" }),
    },
  },
});
