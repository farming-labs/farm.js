import { defineConfig } from "@farm.js/core";
import { hints } from "@farm.js/hints";

export default defineConfig({
  plugins: [hints()],
});
