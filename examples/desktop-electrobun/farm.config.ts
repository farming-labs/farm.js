import { defineConfig } from "@farm.js/core";
import { desktopGuard } from "./src/lib/desktop-guard.ts";

export default defineConfig({
  plugins: [desktopGuard()],
  // The server only answers its own desktop window, so skip the public-site
  // agent surfaces (llms.txt, sitemap, /mcp, /.well-known/farmjs.json).
  agent: {
    jsonLd: false,
    llmsTxt: false,
    sitemap: false,
    mcp: false,
    aiCatalog: false,
    manifest: false,
  },
  // No image optimization: keeps sharp's per-platform native binaries
  // (about 18 MB) out of the app bundle.
  images: { provider: "none" },
});
