import { defineConfig } from "@farm.js/core";
import { wasm } from "@farm.js/wasm";

export default defineConfig({
  basePath: "/lab",
  plugins: [wasm()],
});
