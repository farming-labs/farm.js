/**
 * Server actions in islands mode (RFC 0003), run by islx: `"use server"` modules and inline
 * `"use server"` functions register under stable ids, forms work before JavaScript loads, and
 * captured values travel sealed. Farm supplies its security configuration, the request context
 * actions run in, and how its `redirect()` and `notFound()` answer. The RSC engine has its own.
 */
import { handleAction, registerServerReference } from "@farmjs/islx/server";
import { getFarmRedirectError, isFarmNotFoundError } from "./navigation-errors";
import {
  runWithServerActionRequest,
  type ResolvedFarmServerActionsConfig,
} from "./server-action-security";

/** The header carrying the action id for calls from client components. */
export const FARM_FORM_ACTION_HEADER = "F-Action";

/** Registers a `"use server"` export. Kept for modules compiled before islx registered them. */
export function registerFarmFormAction<T>(action: T, id: string): T {
  return registerServerReference(action, id);
}

/**
 * Runs a server action posted to a page: a form submission, or a call from a client component.
 * Returns `null` for any other request, which then renders as usual.
 */
export function handleFarmFormActionRequest(
  request: Request,
  config: ResolvedFarmServerActionsConfig,
): Promise<Response | null> {
  return handleAction(request, {
    allowedOrigins: config.allowedOrigins,
    bodySizeLimit: config.bodySizeLimit,
    run: (actionRequest, action) => runWithServerActionRequest(actionRequest, action),
    mapError(error) {
      const redirect = getFarmRedirectError(error);
      if (redirect) return { redirect: redirect.url };
      if (isFarmNotFoundError(error)) return { status: 404 };
      return undefined;
    },
    onError: (error) => console.error("[Farm.js] Server action failed:", error),
  });
}
