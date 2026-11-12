/**
 * Server actions in islands mode (RFC 0003), run by islx: `"use server"` modules and inline
 * `"use server"` functions register under stable ids, forms work before JavaScript loads, and
 * captured values travel sealed. Farm supplies its security configuration, the request context
 * actions run in, and how its `redirect()` and `notFound()` answer. The RSC engine has its own.
 */
import { encode, FORM_STATE_SCRIPT_TYPE } from "@farm.js/islx";
import { escapeScriptJson, handleAction, registerServerReference } from "@farm.js/islx/server";
import { FARM_ACTION_RESULT_KEY, type FarmIslandsActionResult } from "./islands-action-protocol";
import { getFarmRedirectError, isFarmNotFoundError } from "./navigation-errors";
import {
  getServerActionInvalidations,
  runWithServerActionRequest,
  sanitizeServerActionError,
  type ResolvedFarmServerActionsConfig,
} from "./server-action-security";
import { serializeServerFnFailure } from "./server-fn-error";
import { _peekCurrentRequest } from "./server/request-bridge";

/** The header carrying the action id for calls from client components. */
export const FARM_FORM_ACTION_HEADER = "F-Action";

/** Registers a `"use server"` export. Kept for modules compiled before islx registered them. */
export function registerFarmFormAction<T>(action: T, id: string): T {
  return registerServerReference(action, id);
}

/**
 * React's form state after a form posted from a `useActionState` hook without JavaScript, by the
 * request that posted it. The page renders for that request with it, and its islands hydrate
 * with it, as the RSC engine renders the page after such a post.
 */
const formStates = new WeakMap<Request, unknown>();

/** The form state the page being rendered shows, if a `useActionState` form posted it. */
export function getFarmFormState(): unknown {
  const request = _peekCurrentRequest();
  return request ? formStates.get(request) : undefined;
}

/** The script that carries the form state to the islands' hydration (islx reads it), or "". */
export function renderFarmFormStateScript(): string {
  const formState = getFarmFormState();
  if (formState === undefined) return "";
  return `<script type="${FORM_STATE_SCRIPT_TYPE}">${escapeScriptJson(JSON.stringify(encode(formState)))}</script>`;
}

/**
 * Runs a server action posted to a page: a form submission, or a call from a client component.
 * Returns `null` for any other request, which then renders as usual, and for a form posted from a
 * `useActionState` hook, whose page then renders with the action's result.
 */
export async function handleFarmFormActionRequest(
  request: Request,
  config: ResolvedFarmServerActionsConfig,
  /** The URL the browser posted to, when a rewrite replaced `request`'s. */
  requestedUrl: string = request.url,
): Promise<Response | null> {
  // A redirect() the action chose stays where it points.
  let actionRedirected = false;
  const response = await handleAction(request, {
    allowedOrigins: config.allowedOrigins,
    bodySizeLimit: config.bodySizeLimit,
    // The result islx sends is the envelope, not the action's own type.
    run: <T>(actionRequest: Request, action: () => Promise<T>) =>
      runFarmFormAction(actionRequest, action) as Promise<T>,
    mapError(error) {
      const redirect = getFarmRedirectError(error);
      if (redirect) {
        actionRedirected = true;
        return { redirect: redirect.url };
      }
      if (isFarmNotFoundError(error)) return { status: 404 };
      // A declared failure (`ServerFnFailure`, invalid input) answers with its own status, as the
      // RSC engine does; it is not logged as a crash.
      const failure = serializeServerFnFailure(error);
      if (failure) return { status: failure.status };
      return undefined;
    },
    onError: (error) => console.error("[Farm.js] Server action failed:", error),
    renderFormState(formState) {
      formStates.set(request, formState);
      // The caller renders the page for this request, as it does for any other post.
      return null as unknown as Response;
    },
  });
  if (!response || actionRedirected) return response;
  return returnToRequestedUrl(response, request.url, requestedUrl);
}

/**
 * A form posted without JavaScript goes back to its page with a 303. After a rewrite, islx sees
 * the rewritten URL, so the browser would land on the rewrite's target; it goes back to the URL it
 * posted to instead, as it does without a rewrite.
 */
function returnToRequestedUrl(response: Response, url: string, requestedUrl: string): Response {
  if (response.status !== 303 || requestedUrl === url) return response;
  const served = new URL(url);
  if (response.headers.get("location") !== served.pathname + served.search) return response;
  const requested = new URL(requestedUrl);
  const headers = new Headers(response.headers);
  headers.set("location", requested.pathname + requested.search);
  return new Response(response.body, { status: 303, headers });
}

/**
 * Runs an action in its request context. A call from JavaScript gets the cache keys it
 * invalidated with its result, and a declared failure (`ServerFnFailure`, invalid input) as data,
 * as the RSC engine sends them; a form posted without JavaScript gets the plain result.
 */
async function runFarmFormAction(request: Request, action: () => Promise<unknown>) {
  if (!request.headers.has(FARM_FORM_ACTION_HEADER)) {
    return runWithServerActionRequest(request, action);
  }
  try {
    return await runWithServerActionRequest(request, async (): Promise<FarmIslandsActionResult> => {
      const value = await action();
      return {
        [FARM_ACTION_RESULT_KEY]: { invalidations: [...getServerActionInvalidations()] },
        value,
      };
    });
  } catch (error) {
    if (!serializeServerFnFailure(error)) throw error;
    return {
      [FARM_ACTION_RESULT_KEY]: { invalidations: [], error: sanitizeServerActionError(error) },
    } satisfies FarmIslandsActionResult;
  }
}
