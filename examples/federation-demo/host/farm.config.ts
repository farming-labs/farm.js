import { defineConfig } from "@farm.js/core";
import { federation } from "@farm.js/federation";

const remoteOrigin = process.env.FARM_FEDERATION_REMOTE_ORIGIN ?? "http://localhost:4101";

export default defineConfig({
  plugins: [
    federation({
      name: "storefront",
      remotes: {
        checkout: {
          entry: `${remoteOrigin.replace(/\/$/, "")}/mf-manifest.json`,
        },
      },
      // Keep the standalone example build independent from a running producer.
      types: false,
    }),
  ],
});
