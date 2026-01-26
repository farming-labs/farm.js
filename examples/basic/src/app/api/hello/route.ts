import { createEndpoint } from "farm";
import { z } from "zod";

export const GET = createEndpoint(
  "/api/hello",
  {
    method: "GET",
    query: z.object({
      name: z.string().optional().meta({
        description: "Get the name of the person to say hello to",
      }),
    }),
  },
  async (ctx) => {
    const name = ctx.query.name || "World";
    return {
      message: `Hello Peeps, ${name}!`,
      timestamp: new Date().toISOString(),
    };
  },
);
export const POST = createEndpoint(
  "/api/hello",
  {
    method: "POST",
    body: z.object({
      name: z.string().optional().meta({
        description: "Get the name of the person to say hello to",
      }),
    }),
  },
  async (ctx) => {
    const name = ctx.body.name || "World";
    return {
      message: `Hello Peeps, ${name}!`,
      timestamp: new Date().toISOString(),
    };
  },
);
