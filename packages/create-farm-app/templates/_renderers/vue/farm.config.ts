import { defineConfig } from "@farm.js/core/config";
import { devtools } from "@farm.js/devtools";
import { vue } from "@farm.js/vue";

export default defineConfig({
  plugins: [devtools()],
  renderer: vue(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "vercel",
  },
});
