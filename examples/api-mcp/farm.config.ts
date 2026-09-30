import { defineConfig } from "@farm.js/core";

const DEMO_TOKEN = "demo-token";

export default defineConfig({
  images: { provider: "none" },
  mcp: {
    authorize: ({ request }) =>
      request.headers.get("authorization") === `Bearer ${DEMO_TOKEN}`
        ? { subject: "demo-agent", scopes: ["projects:read", "projects:write"] }
        : false,
  },
});
