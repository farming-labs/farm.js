import { v } from "convex/values";

export const rateLimitResultValidator = v.object({
  count: v.number(),
  resetAt: v.number(),
});
