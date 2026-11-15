/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> = {
  rateLimits: {
    increment: FunctionReference<
      "mutation",
      "internal",
      { key: string; windowMs: number },
      { count: number; resetAt: number },
      Name
    >;
    read: FunctionReference<
      "query",
      "internal",
      { key: string; now: number },
      { count: number; resetAt: number } | null,
      Name
    >;
  };
  storage: {
    clearItems: FunctionReference<"mutation", "internal", { prefix: string }, number, Name>;
    getItem: FunctionReference<"query", "internal", { key: string }, string | null, Name>;
    listKeys: FunctionReference<"query", "internal", { prefix: string }, Array<string>, Name>;
    removeItem: FunctionReference<"mutation", "internal", { key: string }, null, Name>;
    setItem: FunctionReference<"mutation", "internal", { key: string; value: string }, null, Name>;
  };
};
