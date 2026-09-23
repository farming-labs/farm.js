import { defineConfig } from "@farm.js/core/config";
import { devtools } from "@farm.js/devtools";
import { preact } from "@farm.js/preact";

export default defineConfig({
  plugins: [devtools()],
  renderer: preact(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
