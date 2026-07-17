import { cfAgent } from "@farmjs/cf-agent";
import { defineConfig } from "@farmjs/core";

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
