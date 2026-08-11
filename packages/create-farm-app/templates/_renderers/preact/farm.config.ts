import { defineConfig } from "@farm.js/core/config";
import { preact } from "@farm.js/preact";

export default defineConfig({
  renderer: preact(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
