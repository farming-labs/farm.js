import { defineConfig } from "@farm.js/core";
import { apiMcp } from "@farm.js/mcp";

const DEMO_TOKEN = "demo-token";

export default defineConfig({
  images: { provider: "none" },
  plugins: [
    apiMcp({
      tools: {
        "GET /api/projects": {
          name: "list_projects",
          description: "List projects, optionally filtered by status.",
          readOnlyHint: true,
        },
        "POST /api/projects": {
          name: "create_project",
          description: "Create a project in the demo workspace.",
          destructiveHint: false,
        },
      },
      authorize: ({ request }) =>
        request.headers.get("authorization") === `Bearer ${DEMO_TOKEN}`
          ? { subject: "demo-agent", scopes: ["projects:read", "projects:write"] }
          : false,
    }),
  ],
});
