import { defineConfig } from "@farm.js/core";
import { leaf } from "farm-leaf";

export default defineConfig({
  renderer: leaf(),
  experimental: {
    // Browser modules can import server functions: each call posts to the page.
    serverActions: true,
    // Pages render on the server only, and each client component hydrates as its own island
    // through farm-leaf/server's withIsland (`capabilities.islands`).
    serverComponents: { mode: "islands" },
  },
  deploy: {
    target: "node",
  },
});
