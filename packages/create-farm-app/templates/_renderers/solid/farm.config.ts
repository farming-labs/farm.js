import { defineConfig } from "@farm.js/core/config";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
