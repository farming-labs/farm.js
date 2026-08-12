import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const POST = createEndpoint(
  "/api/greeting",
  {
    method: "POST",
    body: z.object({
      name: z.string().trim().min(1).max(40),
    }),
  },
  async ({ body }) => ({
    message: `Hello, ${body.name}, from the FARMJS server.`,
  }),
);
