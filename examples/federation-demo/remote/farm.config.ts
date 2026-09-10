import { defineConfig } from "@farm.js/core";
import { federation } from "@farm.js/federation";

const origin = process.env.FARM_FEDERATION_REMOTE_ORIGIN ?? "http://localhost:4101";

export default defineConfig({
  plugins: [
    federation({
      name: "checkout",
      exposes: {
        "./UpgradeCard": "./src/components/upgrade-card.tsx",
      },
      publicPath: `${origin.replace(/\/$/, "")}/`,
    }),
  ],
  routeRules: {
    "/**": {
      cors: true,
      headers: {
        "Cross-Origin-Resource-Policy": "cross-origin",
      },
    },
  },
});
