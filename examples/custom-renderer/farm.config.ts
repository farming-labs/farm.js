import { defineConfig } from "@farm.js/core";
import { leaf } from "farm-leaf";

export default defineConfig({
  renderer: leaf(),
  // Browser modules can import server functions: each call posts to the page.
  experimental: { serverActions: true },
  deploy: {
    target: "node",
  },
});
