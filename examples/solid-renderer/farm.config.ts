import { defineConfig } from "@farm.js/core";
import { solid } from "@farm.js/solid";

export default defineConfig({
  renderer: solid(),
  theme: {
    default: "dark",
  },
  deploy: {
    target: "node",
  },
});
