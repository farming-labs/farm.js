import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";

const CLEAR_BATCH_SIZE = 500;

function findItem(context: QueryCtx, key: string) {
  return context.db
    .query("storageItems")
    .withIndex("by_key", (index) => index.eq("key", key))
    .unique();
}

function queryItemsWithPrefix(context: QueryCtx, prefix: string) {
  return context.db
    .query("storageItems")
    .withIndex("by_key", (index) => index.gte("key", prefix).lt("key", `${prefix}￿`));
}

export const getItem = query({
  args: { key: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (context, { key }) => {
    const item = await findItem(context, key);
    return item?.value ?? null;
  },
});

export const setItem = mutation({
  args: { key: v.string(), value: v.string() },
  returns: v.null(),
  handler: async (context, { key, value }) => {
    const item = await findItem(context, key);
    if (item) {
      await context.db.patch(item._id, { value });
      return null;
    }
    await context.db.insert("storageItems", { key, value });
    return null;
  },
});

export const removeItem = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (context, { key }) => {
    const item = await findItem(context, key);
    if (item) await context.db.delete(item._id);
    return null;
  },
});

export const listKeys = query({
  args: { prefix: v.string() },
  returns: v.array(v.string()),
  handler: async (context, { prefix }) => {
    const items = await queryItemsWithPrefix(context, prefix).collect();
    return items.map((item) => item.key);
  },
});

export const clearItems = mutation({
  args: { prefix: v.string() },
  returns: v.number(),
  handler: async (context, { prefix }) => {
    const items = await queryItemsWithPrefix(context, prefix).take(CLEAR_BATCH_SIZE);
    await Promise.all(items.map((item) => context.db.delete(item._id)));
    return items.length;
  },
});
