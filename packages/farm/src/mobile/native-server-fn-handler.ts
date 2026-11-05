/**
 * The endpoint React Native screens call server functions through (see `native-server-fns.ts`).
 * Only apps with a `mobile` block get it, and it runs only the server functions its `resolve`
 * returns: the ones a native screen imports.
 *
 * A call must have the shape only the app sends: `X-Farm-Mobile`, no `Sec-Fetch-*` header, and no
 * `Origin` other than the server's own (the mobile session plugin sets that one on a signed-in
 * device's requests). A cross-site page cannot add the header without a CORS preflight, which
 * this endpoint never answers, so it cannot call a function as the visitor.
 *
 * Every function a native screen imports is a public endpoint, as server actions are: anyone can
 * call it with any input, so it checks its input (its schema) and the caller's rights (its
 * middleware), which run as for any other caller.
 */
import type { FarmPlugin } from "../plugin";
import { DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT } from "../server-action-security";
import { _describeServerFunction, _invokeServerFunction } from "../server-fn";

import { FARM_NATIVE_SERVER_FN_PATH, FARM_NATIVE_SERVER_FN_PLUGIN } from "./native-server-fn-names";

export { FARM_NATIVE_SERVER_FN_PATH, FARM_NATIVE_SERVER_FN_PLUGIN };
const MOBILE_APP_HEADER = "x-farm-mobile";
const FETCH_METADATA = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"];
const ID = /^[\w-]{1,64}$/;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Whether parsed JSON holds a key that could reach an object's prototype in a handler's merge. */
function hasUnsafeKey(value: unknown, depth = 0): boolean {
  if (depth > 64) return true;
  if (Array.isArray(value)) return value.some((item) => hasUnsafeKey(item, depth + 1));
  if (!value || typeof value !== "object") return false;
  return Object.keys(value).some(
    (key) =>
      UNSAFE_KEYS.has(key) || hasUnsafeKey((value as Record<string, unknown>)[key], depth + 1),
  );
}

export interface FarmNativeServerFnOptions {
  /** The server function with this id, if a native screen imports it. */
  resolve(id: string): unknown | Promise<unknown>;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "private, no-store" },
  });
}

function refuse(status: number, code: string, message: string): Response {
  return json(status, { error: { code, message } });
}

/** @internal Exported for tests. */
export async function handleFarmNativeServerFnRequest(
  request: Request,
  options: FarmNativeServerFnOptions,
  /** The body the API route already parsed, when it did. */
  parsed?: unknown,
): Promise<Response> {
  if (request.method !== "POST") {
    return refuse(405, "method_not_allowed", "Call server functions with POST.");
  }
  const origin = request.headers.get("origin");
  if (
    !request.headers.get(MOBILE_APP_HEADER) ||
    FETCH_METADATA.some((name) => request.headers.has(name)) ||
    (origin !== null && origin !== new URL(request.url).origin)
  ) {
    return refuse(403, "not_native", "Only the app's native screens call server functions here.");
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT) {
    return refuse(413, "body_too_large", "The call's input is too large.");
  }
  let call: { id?: unknown; input?: unknown };
  if (parsed !== undefined) call = parsed as typeof call;
  else {
    const text = await request.text();
    if (text.length > DEFAULT_SERVER_ACTION_BODY_SIZE_LIMIT) {
      return refuse(413, "body_too_large", "The call's input is too large.");
    }
    try {
      call = JSON.parse(text) as typeof call;
    } catch {
      return refuse(400, "invalid_body", 'Send { "id", "input" } as JSON.');
    }
  }
  if (typeof call?.id !== "string" || !ID.test(call.id)) {
    return refuse(400, "invalid_body", 'Send { "id", "input" } as JSON.');
  }
  if (hasUnsafeKey(call.input)) {
    return refuse(400, "invalid_body", "The input has a key that is not allowed.");
  }
  const fn = await options.resolve(call.id);
  // Only a createServerFn or createServerQuery function runs, whatever `resolve` returned.
  if (fn === undefined || _describeServerFunction(fn) === undefined) {
    // A bundle from another build of the app, or a function no native screen imports.
    return refuse(
      404,
      "unknown_function",
      "No server function with this id is open to native screens.",
    );
  }
  const outcome = await _invokeServerFunction(fn, call.input, request);
  if (outcome.ok) {
    try {
      return json(200, { data: outcome.data ?? null });
    } catch (error) {
      // A result JSON cannot hold (a cycle, a BigInt): the caller gets no details.
      console.error("[Farm] A server function's result for a native screen is not JSON:", error);
      return refuse(500, "server_error", "Server function failed");
    }
  }
  switch (outcome.reason) {
    case "input":
      // The validator's issues describe the caller's own input.
      return refuse(
        400,
        "invalid_input",
        outcome.error instanceof Error ? outcome.error.message : "The input is invalid.",
      );
    case "failure": {
      const { code, status, message, data } = outcome.failure;
      return json(status, { error: { code, status, message, data } });
    }
    case "redirect":
      return json(200, { redirect: { url: outcome.url, status: outcome.status } });
    default:
      // Anything else can hold private data: it is reported on the server only.
      console.error("[Farm] A server function called from a native screen failed:", outcome.error);
      return refuse(500, "server_error", "Server function failed");
  }
}

/**
 * Only for apps with a `mobile` block; see `config.ts` and the production server entry. An
 * ordinary API route, so a call passes Farm's middleware and `runtime.before` hooks first, in
 * development and in production: the mobile session plugin turns a signed-in device's token into
 * its session, and the function's middleware sees the same user a web page would.
 */
export function createFarmNativeServerFnPlugin(options: FarmNativeServerFnOptions): FarmPlugin {
  return {
    name: FARM_NATIVE_SERVER_FN_PLUGIN,
    routes: ({ route }) => [
      route.post(FARM_NATIVE_SERVER_FN_PATH, {
        handler: (request: Request, { input }: { input: { body?: unknown } }) =>
          handleFarmNativeServerFnRequest(request, options, input.body),
      }),
    ],
  } as FarmPlugin;
}
