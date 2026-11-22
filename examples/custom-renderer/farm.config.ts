import { defineConfig } from "@farm.js/core";
import { leaf } from "farm-leaf";

export default defineConfig({
  renderer: leaf(),
  deploy: {
    target: "node",
  },
});
