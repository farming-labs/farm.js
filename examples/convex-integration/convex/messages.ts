import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { authComponent } from "./auth";

export const list = query({
  args: {},
  handler: async (context) => {
    const messages = await context.db.query("messages").order("desc").take(20);
    return messages.map((message) => ({ id: message._id, author: message.author, body: message.body }));
  },
});

export const send = mutation({
  args: { body: v.string() },
  handler: async (context, { body }) => {
    const user = await authComponent.safeGetAuthUser(context);
    await context.db.insert("messages", { author: user?.name ?? "Guest", body });
  },
});
