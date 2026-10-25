export { _runWithAfterRequest } from "../after";
export { createFarmAppManifestResponse } from "../app-manifest";
export { farmPathGuardCoversEndpoint } from "../middleware/may-handle";
export { farmSecretsMatch } from "../secret-compare";
export { createFarmLayoutSelector } from "../routing/layout-selector";
export { isInRouteGroupScope as isInFarmRouteGroupScope } from "../routing/route-groups";
export { mergeRouteRenderingDirectiveConfig } from "../route-rendering";
export type { FarmServerConfig } from "../server-http";
export {
  bufferFarmRequestBody,
  cloneFarmRequestWithContext,
  createFarmNodeRequestAbortSignal,
  createFarmRequestBodyErrorResponse,
  matchesFarmIfNoneMatch,
  readFarmRequestBody,
  readNodeRequestBody,
  resolveFarmServerConfig,
} from "../server-http";
export { createFarmProductionLifecycle } from "../production-lifecycle";
export { resolveFarmPreviewDeployment } from "../deployment-environment";
export { applyFarmPreviewRobotsTag } from "../preview-noindex";
export {
  createLateNotFoundRecovery,
  createLateRedirectRecovery,
} from "../navigation/late-navigation-recovery";
export {
  _getRequestReadCount,
  _runWithCurrentRequest,
  getCurrentRequest,
  resolveFarmWebRequestOrigin,
} from "../server/request";
export { _runWithAPIRequestRuntime } from "../api/server-context";
export {
  configureFarmCache,
  createFarmCacheKey,
  getFarmDataCache,
  normalizeRevalidatePath,
} from "../cache";
// Server-only, unlike `@farm.js/core/i18n`: `../i18n/config` imports `node:path`
// and the generated client hydration entry imports that public entry.
export { resolveFarmI18nConfig } from "../i18n/config";
export { createFarmLocaleCookie, getFarmLocaleVaryHeaders } from "../i18n/resolver";
export {
  localizeFarmHref,
  localizeFarmPathname,
  stripFarmLocaleFromPathname,
} from "../i18n/routing";
export { renderFarmLocaleAlternateLinks } from "../i18n/alternates";
export {
  addMetadataImageReference,
  addMetadataMarkdownAlternate,
  mergeMetadata,
  mergeModuleViewport,
  renderMetadataHead,
  renderViewportHead,
  resolveFarmNotFoundMetadata,
} from "../metadata";
export { ensureFarmDocumentMeta } from "../server/full-document";
export { createFarmMetadataRouteResponse } from "../metadata-route";
export { generateNativeMCPPluginSource } from "./native-mcp-source";
export {
  _isFarmOwnedResponse,
  _markFarmOwnedResponse,
  _withFarmResponseHeaders,
} from "../owned-response";
export { createFarmAgentRobots } from "../agent-crawlers";
export { createFarmDefaultSitemap } from "../agent-sitemap";
export { collectFarmDefaultMCPPages, resolveFarmDefaultMCPServer } from "../agent-mcp";
export { handleFarmDefaultMCPRequest } from "../agent-mcp-handler";
export { createFarmAiCatalogResponse, listFarmMCPLlmsTxtLinks } from "../ai-catalog";
export { registerFarmMCPServer } from "../mcp-catalog";
export { createFarmApiCatalogResponse } from "../api-catalog";
export {
  collectFarmLlmsTxtPages,
  createFarmDefaultLlmsTxt,
  createFarmLlmsMarkdownReader,
  renderFarmLlmsFullTxt,
  createFarmLlmsFullRenderer,
  resolveFarmLlmsTxtConfig,
  type FarmLlmsTxtUserConfig,
  type ResolvedFarmLlmsTxtConfig,
} from "../llms-txt";
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
export { searchParamsToObject } from "../search-params";
export { parseRoutePath, matchRoute as matchFarmPageRoute } from "../utils";
export { compareRouteSpecificity, getRoutePatternSpecificity } from "../routing/specificity";
export { createFarmLegacyRequest } from "./legacy-request";
export {
  renderFarmLegacyErrorHtml,
  renderFarmLegacyHtml,
  serializeFarmInlineValue,
} from "./legacy-runtime";
export {
  resolveFarmTrailingSlashRedirect,
  setFarmTrailingSlashPreference,
} from "../trailing-slash";
export { applyFarmBasePath, setFarmBasePath, stripFarmBasePath } from "../base-path";
export { appendFarmRedirectQuery } from "../redirect-query";
export { applyFarmCspNonceToResponse, resolveFarmSecurityConfig } from "../security";

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
