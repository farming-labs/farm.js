import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import authConfig from "./auth.config";

const siteURL = process.env.SITE_URL ?? "http://localhost:3000";

export const authComponent = createClient<DataModel>(components.betterAuth);

export const createAuth = (context: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: siteURL,
    database: authComponent.adapter(context),
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [convex({ authConfig })],
  });

export const currentUser = query({
  args: {},
  handler: async (context) => {
    const user = await authComponent.safeGetAuthUser(context);
    return user ? { name: user.name, email: user.email } : null;
  },
});
