import { defineConfig } from "@farm.js/core";

export default defineConfig({
  // `farm dev --desktop` and `farm build --desktop` read this; a web build ignores it.
  desktop: {
    name: "Farm Notes",
    id: "dev.farmjs.examples.desktop-notes",
    window: { width: 900, height: 700 },
  },
});
