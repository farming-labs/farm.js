import { defineConfig } from "@farm.js/core";
import { defineTool } from "@farm.js/mcp";
import { z } from "zod";
import { GET as listProjects, POST as createProject } from "./src/app/api/projects/route";
import { projects } from "./src/lib/projects";

const DEMO_TOKEN = "demo-token";

export default defineConfig({
  images: { provider: "none" },
  mcp: {
    name: "projects",
    tools: [
      {
        endpoint: listProjects,
        name: "list_projects",
        description: "List projects, optionally filtered by status.",
      },
      {
        endpoint: createProject,
        name: "create_project",
        description: "Create a project in the demo workspace.",
        destructiveHint: false,
      },
      defineTool({
        name: "search_projects",
        description: "Search the demo workspace without a separate HTTP route.",
        inputSchema: z.object({ query: z.string().trim().min(1) }),
        readOnlyHint: true,
        destructiveHint: false,
        execute: ({ query }, { authorization, signal }) => {
          signal.throwIfAborted();
          return {
            projects: projects.filter((project) =>
              project.name.toLowerCase().includes(query.toLowerCase()),
            ),
            actor: authorization.subject,
          };
        },
      }),
    ],
    authorize: ({ request, tools }) => {
      const token = request.headers.get("authorization");
      const writer = token === `Bearer ${DEMO_TOKEN}`;
      if (!writer && token !== "Bearer demo-reader") return false;
      return {
        subject: writer ? "demo-agent" : "demo-reader",
        tools: tools
          .filter((tool) => writer || ["list_projects", "search_projects"].includes(tool.name))
          .map((tool) => tool.name),
      };
    },
  },
});
