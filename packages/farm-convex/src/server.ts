import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { convexToJson } from "convex/values";
import { getCurrentRequest } from "@farm.js/core/request";

import { requireConvexRuntime } from "./runtime.js";

import type { Preloaded } from "convex/react";
import type { ArgsAndOptions, FunctionReference, FunctionReturnType } from "convex/server";
import type { ConvexRuntime, ConvexServerOptions } from "./types.js";

const MISSING_REQUEST_MESSAGE = "No current request is available";

function readCurrentRequest(): Request | undefined {
  try {
    return getCurrentRequest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith(MISSING_REQUEST_MESSAGE)) return undefined;
    throw error;
  }
}

const fetchWithoutCache: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

function keepPageOutOfSharedCache(): void {
  readCurrentRequest();
}

// A page that runs several queries reads the visitor's token once.
const tokensByRequest = new WeakMap<Request, Promise<string | undefined>>();

async function readRequestToken(
  reader: NonNullable<ConvexRuntime["token"]>,
  request: Request,
): Promise<string | undefined> {
  let token = tokensByRequest.get(request);
  if (!token) {
    token = Promise.resolve(reader(request)).then((value) => value ?? undefined);
    tokensByRequest.set(request, token);
  }
  return token;
}

async function resolveToken(options: ConvexServerOptions): Promise<string | undefined> {
  if (options.token !== undefined) return options.token;
  const runtime = requireConvexRuntime();
  const request = options.request ?? readCurrentRequest();
  if (!runtime.token || !request) return undefined;
  return readRequestToken(runtime.token, request);
}

export async function createConvexServerClient(
  options: ConvexServerOptions = {},
): Promise<ConvexHttpClient> {
  const runtime = requireConvexRuntime();
  const token = await resolveToken(options);
  return new ConvexHttpClient(runtime.url, { auth: token, fetch: fetchWithoutCache });
}

export async function fetchQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...argsAndOptions: ArgsAndOptions<Query, ConvexServerOptions>
): Promise<FunctionReturnType<Query>> {
  const [args, options] = argsAndOptions;
  const client = await createConvexServerClient(options ?? {});
  return client.query(query, args ?? {});
}

export async function fetchMutation<Mutation extends FunctionReference<"mutation">>(
  mutation: Mutation,
  ...argsAndOptions: ArgsAndOptions<Mutation, ConvexServerOptions>
): Promise<FunctionReturnType<Mutation>> {
  const [args, options] = argsAndOptions;
  const client = await createConvexServerClient(options ?? {});
  return client.mutation(mutation, args ?? {});
}

export async function fetchAction<Action extends FunctionReference<"action">>(
  action: Action,
  ...argsAndOptions: ArgsAndOptions<Action, ConvexServerOptions>
): Promise<FunctionReturnType<Action>> {
  const [args, options] = argsAndOptions;
  const client = await createConvexServerClient(options ?? {});
  return client.action(action, args ?? {});
}

export async function preloadQuery<Query extends FunctionReference<"query">>(
  query: Query,
  ...argsAndOptions: ArgsAndOptions<Query, ConvexServerOptions>
): Promise<Preloaded<Query>> {
  const [args] = argsAndOptions;
  keepPageOutOfSharedCache();
  const value = await fetchQuery(query, ...argsAndOptions);
  return {
    _name: getFunctionName(query),
    _argsJSON: convexToJson(args ?? {}),
    _valueJSON: convexToJson(value),
  } as Preloaded<Query>;
}
