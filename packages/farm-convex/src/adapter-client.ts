import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

import { requireConvexRuntime } from "./runtime.js";
import { readAdapterSecret } from "./secret.js";

import type { ConvexAdapterCaller, ConvexAdapterOptions } from "./types.js";

const DEFAULT_MODULE = "farm";

export function createAdapterCaller(options: ConvexAdapterOptions): ConvexAdapterCaller {
  let client: ConvexHttpClient | undefined;
  const readClient = () => {
    client ??= new ConvexHttpClient(options.url ?? requireConvexRuntime().url);
    return client;
  };
  const nameFunction = (name: string) => `${options.module ?? DEFAULT_MODULE}:${name}`;
  const withSecret = (args: Record<string, unknown>) => ({
    ...args,
    secret: readAdapterSecret(options.secret),
  });
  return {
    query: (name, args) =>
      readClient().query(makeFunctionReference<"query">(nameFunction(name)), withSecret(args)),
    mutation: (name, args) =>
      readClient().mutation(
        makeFunctionReference<"mutation">(nameFunction(name)),
        withSecret(args),
      ),
  };
}
