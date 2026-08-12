import { defineConfig } from "@farm.js/core/config";
import { svelte } from "@farm.js/svelte";

export default defineConfig({
  renderer: svelte(),
  theme: {
    default: "dark",
  },
});
