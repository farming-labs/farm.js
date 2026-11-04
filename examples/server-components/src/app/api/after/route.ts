import { createEndpoint } from "@farm.js/core/api";
import { z } from "zod";
import { afterLog } from "../../../lib/after-log";

// What /after's after() callback recorded for a token, or null while it has not run.
export const GET = createEndpoint(
  "/api/after",
  { method: "GET", query: z.object({ token: z.string().min(1) }) },
  async (ctx) => ({ written: afterLog().get(ctx.query.token) ?? null }),
);
