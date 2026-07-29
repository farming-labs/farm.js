import { defineConfig } from "bumpp";

export default defineConfig({
  commit: "chore: release v%s",
  tag: "v%s",
  push: true,
  files: [
    "packages/farm/package.json",
    "packages/create-farm-app/package.json",
    "packages/farm-cf-agent/package.json",
    "packages/farm-cli/package.json",
    "packages/farm-eve/package.json",
    "packages/farm-integrations/package.json",
    "packages/farm-preview-gateway/package.json",
    "packages/farmjs-plugin/package.json",
  ],
  execute: "pnpm build",
});
