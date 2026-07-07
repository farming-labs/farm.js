import { defineFarmConfig } from "@farmjs/core";

const target = process.env.FARM_DEPLOY_TARGET || "vercel";

export default defineFarmConfig({
  deploy: {
    target,
    cloudflare: {
      projectName: process.env.CLOUDFLARE_PAGES_PROJECT,
    },
    netlify: {
      site: process.env.NETLIFY_SITE_ID,
    },
  },
});
