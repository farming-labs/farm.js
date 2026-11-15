import { defineConfig } from "@farm.js/core";
import { vue } from "@farm.js/vue";

export default defineConfig({
  renderer: vue({ app: "./src/vue-app.ts" }),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
