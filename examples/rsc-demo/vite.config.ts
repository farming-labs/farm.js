import rsc from "@vitejs/plugin-rsc";
import react from "@vitejs/plugin-react";
import { defineConfig, nitro } from "@farmjs/plugin/rsc";

// Preset: "vercel" (default) | "cloudflare_pages" | "cloudflare_module" (set NITRO_PRESET for Cloudflare).
const nitroPreset = process.env.NITRO_PRESET || "vercel";

export default defineConfig({
  srcDir: "src",
  outDir: "dist",
  port: 3000,
  debug: false,
  // RSC is enabled by default - no need to explicitly set experimental.serverComponents
  // experimental: { serverComponents: true, serverActions: true }, // Defaults to true
  plugins: [
    rsc({
      serverHandler: false,
      entries: {
        rsc: "./.farm/rsc-entries/entry.rsc.tsx",
        ssr: "./.farm/rsc-entries/entry.ssr.tsx",
        client: "./.farm/rsc-entries/entry.browser.tsx",
      },
    }),
    react(),
    nitro({
      server: { environmentName: "rsc" },
      config: { preset: nitroPreset },
    }),
  ],
});
