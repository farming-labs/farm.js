import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rateLimits: defineTable({
    key: v.string(),
    count: v.number(),
    resetAt: v.number(),
  }).index("by_key", ["key"]),
  storageItems: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
