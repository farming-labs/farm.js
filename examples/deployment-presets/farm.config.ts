import { defineFarmConfig } from "@farmjs/core";

const preset = process.env.NITRO_PRESET;
const target = preset ? undefined : process.env.FARM_DEPLOY_TARGET || "vercel";

export default defineFarmConfig({
  deploy: {
    target,
    preset,
    ...(preset ? { output: ".output" } : {}),
    cloudflare: {
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT,
    },
    netlify: {
      site: process.env.NETLIFY_SITE_ID,
    },
  },
});
