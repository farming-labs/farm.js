import type { ConvexPair, ConvexService } from "./types.js";

export const FARM_BUILT_IN_AUTH = "farm-auth";

export const CONVEX_COMPONENT_SERVICES: Readonly<Record<string, ConvexService>> = {
  "@convex-dev/better-auth": "auth",
  "@convex-dev/workos-authkit": "auth",
  "@convex-dev/polar": "billing",
  "@convex-dev/stripe": "billing",
  "@useautumn/convex": "billing",
};

export const FARM_INTEGRATION_SERVICES: Readonly<Record<string, ConvexService>> = {
  [FARM_BUILT_IN_AUTH]: "auth",
  "better-auth": "auth",
  clerk: "auth",
  workos: "auth",
  auth0: "auth",
  authjs: "auth",
  supabase: "auth",
  polar: "billing",
  stripe: "billing",
  autumn: "billing",
};

export const CONVEX_PAIRS: readonly ConvexPair[] = [
  {
    service: "auth",
    component: "@convex-dev/workos-authkit",
    integration: "workos",
    relation: "together",
  },
];
