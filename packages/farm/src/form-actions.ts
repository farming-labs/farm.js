/**
 * Server actions in islands mode (RFC 0003). A `"use server"` module's exports register here with a
 * stable id. A form posts the id with its fields, so actions work before JavaScript loads; a client
 * component calls the id through the same endpoint. The RSC engine has its own actions.
 */
import { setFarmActionId } from "./client/action-reference";
import { decodeFarmJson, encodeFarmJson } from "./client/island-codec";
import { getFarmRedirectError, isFarmNotFoundError } from "./navigation-errors";
import {
  createServerActionRequestErrorResponse,
  prepareServerActionRequest,
  runWithServerActionRequest,
  type ResolvedFarmServerActionsConfig,
} from "./server-action-security";

/** The form field carrying the action id. */
export const FARM_FORM_ACTION_FIELD = "$FARM_ACTION";
/** The header carrying the action id for calls from client components. */
export const FARM_FORM_ACTION_HEADER = "x-farm-action";

type FarmAction = (...args: unknown[]) => unknown;

// Shared across the CJS and ESM copies of this module.
const REGISTRY_KEY = Symbol.for("farm.form-actions");
function registry(): Map<string, FarmAction> {
  const scope = globalThis as unknown as Record<symbol, Map<string, FarmAction> | undefined>;
  return (scope[REGISTRY_KEY] ??= new Map());
}

/**
 * Registers a server action and gives it React's progressive-enhancement hook: a server-rendered
 * `<form action={fn}>` becomes a POST to the current page with the action id in a hidden field.
 */
export function registerFarmFormAction<T>(action: T, id: string): T {
  if (typeof action !== "function") return action;
  registry().set(id, action as FarmAction);
  setFarmActionId(action as object, id);
  if (!Object.prototype.hasOwnProperty.call(action, "$$FORM_ACTION")) {
    Object.defineProperty(action, "$$FORM_ACTION", {
      value: () => {
        const data = new FormData();
        data.append(FARM_FORM_ACTION_FIELD, id);
        return { action: "", method: "POST", encType: "multipart/form-data", data };
      },
    });
  }
  return action;
}

function noStore(status: number, body: string | null, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function actionErrorResponse(error: unknown, kind: "form" | "javascript"): Response {
  const redirect = getFarmRedirectError(error);
  if (redirect) {
    return kind === "form"
      ? noStore(303, null, { location: redirect.url })
      : noStore(200, JSON.stringify({ redirect: redirect.url }), {
          "content-type": "application/json",
        });
  }
  if (isFarmNotFoundError(error)) return noStore(404, "Not Found");
  console.error("[Farm.js] Server action failed:", error);
  return noStore(500, "Server action failed");
}

/**
 * Runs a server action posted to a page: a form submission carrying the action field, or a call
 * from a client component carrying the action header. Returns `null` for any other request, which
 * then renders as usual.
 */
export async function handleFarmFormActionRequest(
  request: Request,
  config: ResolvedFarmServerActionsConfig,
): Promise<Response | null> {
  if (request.method.toUpperCase() !== "POST") return null;
  const headerId = request.headers.get(FARM_FORM_ACTION_HEADER);
  const contentType = request.headers.get("content-type") || "";

  if (headerId) {
    let prepared;
    try {
      prepared = await prepareServerActionRequest(request, config, "javascript", headerId);
    } catch (error) {
      return createServerActionRequestErrorResponse(error) ?? noStore(400, "Bad Request");
    }
    const action = registry().get(headerId);
    if (!action) return noStore(404, "Not Found");
    let args: unknown[];
    try {
      // Arguments keep their types (Date, Map, BigInt, …): see island-codec.ts.
      const decoded =
        prepared.body instanceof FormData
          ? [prepared.body]
          : decodeFarmJson(JSON.parse(prepared.body || "[]"));
      if (!Array.isArray(decoded)) throw new TypeError("arguments must be an array");
      args = decoded;
    } catch {
      return noStore(400, "Bad Request");
    }
    try {
      const result = await runWithServerActionRequest(request, () => action(...args));
      return noStore(200, JSON.stringify({ result: encodeFarmJson(result) }), {
        "content-type": "application/json",
      });
    } catch (error) {
      return actionErrorResponse(error, "javascript");
    }
  }

  if (!/^(multipart\/form-data|application\/x-www-form-urlencoded)/i.test(contentType)) return null;
  let prepared;
  try {
    prepared = await prepareServerActionRequest(request.clone(), config, "form");
  } catch (error) {
    return createServerActionRequestErrorResponse(error) ?? noStore(400, "Bad Request");
  }
  const form = prepared.body as FormData;
  const id = form.get(FARM_FORM_ACTION_FIELD);
  if (typeof id !== "string") return null;
  const action = registry().get(id);
  if (!action) return noStore(404, "Not Found");
  form.delete(FARM_FORM_ACTION_FIELD);
  try {
    await runWithServerActionRequest(request, () => action(form));
  } catch (error) {
    return actionErrorResponse(error, "form");
  }
  // Post/redirect/get: the browser loads the page again and sees what the action changed.
  const url = new URL(request.url);
  return noStore(303, null, { location: url.pathname + url.search });
}
