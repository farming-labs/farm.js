export { _runWithAfterRequest } from "../after";
export {
  bufferFarmRequestBody,
  createFarmRequestBodyErrorResponse,
  resolveFarmServerConfig,
} from "../server-http";
export { createFarmProductionLifecycle } from "../production-lifecycle";
export { _runWithCurrentRequest, getCurrentRequest } from "../server/request";
export {
  configureFarmCache,
  createFarmCacheKey,
  getFarmDataCache,
  normalizeRevalidatePath,
} from "../cache";
export { createFarmLocaleCookie, getFarmLocaleVaryHeaders } from "../i18n/resolver";
export {
  localizeFarmHref,
  localizeFarmPathname,
  stripFarmLocaleFromPathname,
} from "../i18n/routing";
export { addMetadataImageReference, mergeMetadata, renderMetadataHead } from "../metadata";
export {
  applyProductionMiddlewareHeaders,
  createProductionMiddlewareRunner,
} from "../middleware/production-runtime";
export { _runWithMiddlewareContext, _runWithMiddlewareData } from "../middleware/server";
export {
  getFarmRedirectError,
  isFarmNotFoundError,
  isFarmRedirectError,
} from "../navigation-errors";
export {
  configureFarmObservability,
  emitFarmEvent,
  runWithFarmRequestSpan,
} from "../observability";
export {
  createFarmInstrumentationLifecycle,
  resolveFarmInstrumentationRuntime,
} from "../instrumentation-runtime";
export { resolveFarmRouteContext, withFarmRouteContext } from "../route-context";
export { _setDefaultFarmThemeConfig, getTheme } from "../theme/server";
export { applyFarmThemeDocument, createFarmThemeDocumentParts } from "../theme/server-runtime";
export {
  createDefaultErrorMarkup,
  getDefaultErrorStatusText,
  resolveDefaultErrorStatus,
} from "../components/error-page";
export {
  manageFarmDocumentPreloads,
  manageFarmHtmlPreloads,
  manageFarmLinkHeaderPreloads,
  reportFarmPreloadWarnings,
} from "../preload";

export function appendFarmLinkHeader(headers: Headers, value: string): void {
  const current = headers.get("Link");
  if (!current) {
    headers.set("Link", value);
    return;
  }
  if (current !== value && !current.endsWith(`, ${value}`)) {
    headers.set("Link", `${current}, ${value}`);
  }
}
