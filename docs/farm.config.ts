import { defineConfig } from "@farm.js/core";

export default defineConfig({
  docs: {
    entry: "/docs",
  },
  notFound: {
    component: "./src/app/not-found.tsx",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
  deploy: {
    target: "vercel",
  },
});
