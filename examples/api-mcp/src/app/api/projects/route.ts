import { createEndpoint, type EndpointMiddlewareContext } from "@farm.js/core/api";
import { z } from "zod";
import { projects } from "../../../lib/projects";

const DEMO_TOKEN = "demo-token";

function requireDemoToken({ request }: EndpointMiddlewareContext) {
  if (request.headers.get("authorization") !== `Bearer ${DEMO_TOKEN}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { actor: "demo-agent" };
}

export const GET = createEndpoint(
  {
    method: "GET",
    query: z.object({ status: z.enum(["active", "planned"]).optional() }),
    middleware: [requireDemoToken],
  },
  async ({ query, context }) => ({
    projects: query.status
      ? projects.filter((project) => project.status === query.status)
      : projects,
    actor: context.actor,
  }),
);

export const POST = createEndpoint(
  {
    method: "POST",
    body: z.object({
      name: z.string().trim().min(2).max(80),
      status: z.enum(["active", "planned"]).default("planned"),
    }),
    middleware: [requireDemoToken],
  },
  async ({ body, context }) => {
    const project = {
      id: `project-${projects.length + 1}`,
      name: body.name,
      status: body.status,
    } as const;
    projects.push(project);
    return { project, actor: context.actor };
  },
);
