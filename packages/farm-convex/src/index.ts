import { defineIntegration } from "@farm.js/core";

import { createConvexPlugin, resolveDevOptions } from "./dev.js";
import { detectExtensions, mergeExtensions } from "./detect.js";
import { hasDeploymentURL, resolveDeploymentURLs } from "./environment.js";
import { checkExtensions, createExtensionRoutes, pickExtensionValue } from "./extensions.js";
import { setConvexRuntime } from "./runtime.js";
import { createSiteTokenReader } from "./site-token.js";

import type { ConvexExtension, ConvexIntegrationInput, ConvexTokenReader } from "./types.js";

const DEFAULT_PROVIDER = { module: "@farm.js/convex/client", export: "ConvexClientProvider" };
const DEFAULT_FUNCTIONS_DIRECTORY = "convex";

function resolveTokenReader(
  input: ConvexIntegrationInput,
  extensions: readonly ConvexExtension[],
  siteURL: string,
): ConvexTokenReader | undefined {
  if (input.token) return input.token;
  const token = pickExtensionValue(extensions, "token");
  if (token) return token;
  const siteToken = pickExtensionValue(extensions, "siteToken");
  return siteToken ? createSiteTokenReader(siteToken, siteURL) : undefined;
}

function isDevelopment(): boolean {
  const mode = process.env.NODE_ENV;
  return mode === undefined || mode === "development";
}

function resolveExtensions(input: ConvexIntegrationInput, functionsDirectory: string) {
  const detected =
    input.detect === false
      ? []
      : detectExtensions(process.cwd(), functionsDirectory, input.home ?? {});
  return mergeExtensions(detected, input.use ?? []);
}

// A new app has no deployment yet. farm dev runs convex dev, which creates one and writes
// CONVEX_URL to .env.local; the app connects after a restart.
function waitForDeployment(input: ConvexIntegrationInput, functionsDirectory: string) {
  return defineIntegration({
    category: "database",
    type: "convex",
    instance: undefined,
    log: input.log,
    plugins: [
      createConvexPlugin({
        dev: resolveDevOptions(input.dev),
        homes: input.home ?? {},
        functionsDirectory,
        extensions: [],
        waitingForDeployment: true,
      }),
    ],
  });
}

export function convex(input: ConvexIntegrationInput = {}) {
  const functionsDirectory = input.functionsDirectory ?? DEFAULT_FUNCTIONS_DIRECTORY;
  if (!hasDeploymentURL(input) && isDevelopment()) {
    return waitForDeployment(input, functionsDirectory);
  }
  const urls = resolveDeploymentURLs(input);
  const extensions = resolveExtensions(input, functionsDirectory);
  checkExtensions(extensions);
  setConvexRuntime({ ...urls, token: resolveTokenReader(input, extensions, urls.siteURL) });
  const tokenPath = input.tokenPath ?? pickExtensionValue(extensions, "tokenPath");
  return defineIntegration({
    category: "database",
    type: "convex",
    instance: urls,
    log: input.log,
    routes: createExtensionRoutes(extensions, urls.siteURL),
    providers: [
      {
        name: "convex-provider",
        type: "convex",
        props: tokenPath ? { url: urls.url, tokenPath } : { url: urls.url },
        supportsIsolatedHydration: true,
        component: input.provider ?? pickExtensionValue(extensions, "provider") ?? DEFAULT_PROVIDER,
      },
    ],
    plugins: [
      createConvexPlugin({
        dev: resolveDevOptions(input.dev),
        homes: input.home ?? {},
        functionsDirectory,
        extensions,
      }),
    ],
  });
}

export { component } from "./component.js";
export { KNOWN_COMPONENTS } from "./known.js";
export { convexRateLimitStorage } from "./rate-limit.js";
export { convexStorage } from "./storage.js";
export { CONVEX_PAIRS } from "./pairs.js";
export type {
  ConvexAdapterOptions,
  ConvexComponentOptions,
  ConvexDevOptions,
  ConvexExtension,
  ConvexExtensionRoute,
  ConvexHomes,
  ConvexIntegrationInput,
  ConvexPair,
  ConvexService,
  ConvexServiceSide,
  ConvexSiteToken,
  ConvexTokenReader,
} from "./types.js";
