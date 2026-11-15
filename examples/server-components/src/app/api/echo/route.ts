import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";

export const GET = createEndpoint(
  "/api/echo",
  { method: "GET", query: z.object({ word: z.string().min(1).optional() }) },
  async (ctx) => ({ echo: ctx.query.word ?? "none" }),
);

export const POST = createEndpoint(
  "/api/echo",
  { method: "POST", body: z.object({ word: z.string().min(1) }) },
  async (ctx) => ({ echo: ctx.body.word }),
);
