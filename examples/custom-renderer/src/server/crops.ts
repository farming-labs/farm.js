import { createEndpoint } from "@farm.js/core/api";
import { createServerFn } from "@farm.js/core/server-fn";
import { z } from "zod";

export const CROPS = ["wheat", "barley", "rye"] as const;

const plantInput = z.object({ name: z.enum(CROPS) });

let planted = 0;

// Runs only on the server. The browser reaches it through the endpoint below.
export const plantCrop = createServerFn({
  input: plantInput,
  async handler({ input }) {
    planted += 1;
    return { message: `Planted ${input.name} on the server.`, planted };
  },
});

export const plantEndpoint = createEndpoint(
  "/api/plant",
  { method: "POST", body: plantInput },
  async ({ body }) => plantCrop(body),
);
