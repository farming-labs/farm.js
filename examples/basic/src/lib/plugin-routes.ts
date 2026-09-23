import { definePlugin } from "@farm.js/core";
import { z } from "zod";

// This module is server-only. Callers import only the generated types and manifest.
export const projectRoutes = definePlugin({
  name: "example:project-routes",
  routes: ({ route }) => {
    const project = route.scope("/api/projects/[projectId]");
    return [
      project.get("uploads/[uploadId]", {
        input: {
          params: z.object({ projectId: z.string().min(1), uploadId: z.string().min(1) }),
          query: z.object({ view: z.enum(["summary", "full"]).default("summary") }),
        },
        handler(_request, { input }) {
          return { projectId: input.params.projectId, uploadId: input.params.uploadId, view: input.query.view };
        },
      }),
    ];
  },
});
