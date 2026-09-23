import { defineConfig } from "@farm.js/core";
import { webmcp } from "@farm.js/webmcp";

export default defineConfig({
  plugins: [webmcp()],
});
