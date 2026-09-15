import { defineConfig } from "@farm.js/core/config";
import { devtools } from "@farm.js/devtools";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  plugins: [devtools()],
  renderer: svelte(),
  theme: {
    default: "dark",
  },
});
