import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  "/api/examples/quote",
  {
    method: "GET",
    query: z.object({ quantity: z.coerce.number().int().min(1).max(20) }),
  },
  async ({ query }) => {
    const unitPriceCents = 1200;
    return {
      item: "Canvas bag",
      currency: "USD",
      quantity: query.quantity,
      unitPriceCents,
      totalCents: query.quantity * unitPriceCents,
    };
  },
);
