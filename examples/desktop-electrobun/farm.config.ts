import { defineConfig } from "@farm.js/core";

export default defineConfig({
  // `farm dev --desktop` and `farm build --desktop` call this once; a web build never does.
  // `farm build --desktop --profile beta` builds a side-by-side beta with its own app data.
  desktop: ({ profile }) => ({
    name: profile === "beta" ? "Farm Notes Beta" : "Farm Notes",
    id:
      profile === "beta"
        ? "dev.farmjs.examples.desktop-notes.beta"
        : "dev.farmjs.examples.desktop-notes",
    window: { width: 900, height: 700 },
  }),
});
