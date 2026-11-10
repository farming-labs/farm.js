import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { rateLimitResultValidator } from "./validators";

export const increment = mutation({
  args: { key: v.string(), windowMs: v.number() },
  returns: rateLimitResultValidator,
  handler: async (context, { key, windowMs }) => {
    const now = Date.now();
    const existing = await context.db
      .query("rateLimits")
      .withIndex("by_key", (index) => index.eq("key", key))
      .unique();
    if (!existing) {
      const resetAt = now + windowMs;
      await context.db.insert("rateLimits", { key, count: 1, resetAt });
      return { count: 1, resetAt };
    }
    if (existing.resetAt <= now) {
      const resetAt = now + windowMs;
      await context.db.patch(existing._id, { count: 1, resetAt });
      return { count: 1, resetAt };
    }
    const count = existing.count + 1;
    await context.db.patch(existing._id, { count });
    return { count, resetAt: existing.resetAt };
  },
});

export const read = query({
  args: { key: v.string(), now: v.number() },
  returns: v.union(rateLimitResultValidator, v.null()),
  handler: async (context, { key, now }) => {
    const existing = await context.db
      .query("rateLimits")
      .withIndex("by_key", (index) => index.eq("key", key))
      .unique();
    if (!existing || existing.resetAt <= now) return null;
    return { count: existing.count, resetAt: existing.resetAt };
  },
});
