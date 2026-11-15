import { KNOWN_COMPONENTS } from "./known.js";

import type { ConvexComponentOptions, ConvexExtension, ConvexExtensionRoute } from "./types.js";
import type { ConvexKnownComponent, ConvexService } from "./types.js";

function toRoutes(routes: ConvexComponentOptions["routes"]): ConvexExtensionRoute[] {
  if (!routes) return [];
  if (Array.isArray(routes)) return [...routes];
  return Object.entries(routes).map(([path, to]) => ({ path, to }));
}

function toWebhookRoute(
  packageName: string,
  known: ConvexKnownComponent | undefined,
  { webhooks, convexPath }: ConvexComponentOptions,
): ConvexExtensionRoute[] {
  if (!webhooks) return [];
  const to = convexPath ?? known?.webhook?.convexPath;
  const path = webhooks === true ? known?.webhook?.path : webhooks;
  if (!to || !path) {
    throw new TypeError(
      `component("${packageName}") has no default webhook paths. Pass webhooks: "/your/path" and convexPath.`,
    );
  }
  return [{ path, methods: ["POST"], to }];
}

function withoutUndefined(extension: ConvexExtension): ConvexExtension {
  return Object.fromEntries(
    Object.entries(extension).filter(([, value]) => value !== undefined),
  ) as unknown as ConvexExtension;
}

/**
 * Any Convex component, wired into Farm by convex({ use }). Well-known components, such as
 * "@convex-dev/better-auth" or "@convex-dev/stripe", come with their routes and defaults.
 */
export function component(
  packageName: string,
  options: ConvexComponentOptions = {},
): ConvexExtension {
  if (!packageName.trim()) throw new TypeError("component() needs the component's package name.");
  const known = KNOWN_COMPONENTS[packageName];
  return withoutUndefined({
    name: options.name ?? known?.name ?? packageName,
    component: packageName,
    service: known?.service,
    routes: [
      ...(known?.routes ?? []),
      ...toRoutes(options.routes),
      ...toWebhookRoute(packageName, known, options),
    ],
    token: options.token,
    siteToken: options.token ? undefined : known?.siteToken,
    tokenPath: options.tokenPath ?? known?.tokenPath,
    provider: options.provider,
  });
}

/** Whether an extension signs visitors in: a token, a site token, a token path or a provider. */
export function signsVisitorsIn(extension: ConvexExtension): boolean {
  return Boolean(
    extension.token || extension.siteToken || extension.tokenPath || extension.provider,
  );
}

/** The kind of service an extension provides; signing visitors in means auth. */
export function readExtensionService(extension: ConvexExtension): ConvexService | undefined {
  return extension.service ?? (signsVisitorsIn(extension) ? "auth" : undefined);
}
