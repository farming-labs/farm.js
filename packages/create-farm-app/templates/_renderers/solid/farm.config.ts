import { defineConfig } from "@farm.js/core/config";
import { devtools } from "@farm.js/devtools";
import { solid } from "@farm.js/solid";

export default defineConfig({
  plugins: [devtools()],
  renderer: solid(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
