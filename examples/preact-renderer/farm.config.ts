import { defineConfig } from "@farm.js/core";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
