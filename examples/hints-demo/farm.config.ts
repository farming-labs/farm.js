import { defineConfig } from "@farm.js/core";
import { hints } from "@farm.js/hints";
import { devtools } from "@farm.js/devtools";

export default defineConfig({
  plugins: [devtools(), hints()],
});
