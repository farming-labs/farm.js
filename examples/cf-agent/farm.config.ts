import { cfAgent } from "@farm.js/cf-agent";
import { defineConfig } from "@farm.js/core";

export default defineConfig({
  integrations: {
    agent: cfAgent(),
  },
  deploy: {
    target: "cloudflare",
    preset: "cloudflare-module",
    output: ".output",
  },
});
