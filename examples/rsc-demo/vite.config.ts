import tailwindcss from "@tailwindcss/vite";
import rsc from "@vitejs/plugin-rsc";
import react from "@vitejs/plugin-react";
import { defineConfig, nitro } from "@farm.js/plugin/rsc";
import { productQuery } from "./src/actions/server-query.ts";
import { GET as listUsers } from "./src/api/users/route.ts";

// Preset: "vercel" (default) | "cloudflare_pages" | "cloudflare_module" (set NITRO_PRESET for Cloudflare).
const nitroPreset = process.env.NITRO_PRESET || "vercel";

export default defineConfig({
  srcDir: "src",
  routesDir: "",
  outDir: "dist",
  // An MCP endpoint at /api/mcp. The tools only read demo data.
  mcp: {
    name: "rsc-demo",
    allowUnauthenticated: true,
    tools: [
      { endpoint: listUsers, name: "list_users", description: "List the demo users." },
      productQuery,
    ],
  },
  port: 3000,
  debug: false,
  experimental: {
    // Server Actions are a separate, explicit opt-in from RSC rendering.
    serverActions: true,
    optimizedBoundary: true,
  },
  plugins: [
    tailwindcss(),
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
