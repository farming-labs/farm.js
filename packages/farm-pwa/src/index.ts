import { definePlugin } from "@farm.js/core/plugin";
import { normalizeBasePath, withBasePath, writePwaBuildArtifacts } from "./build.js";
import {
  resolvePwaOptions,
  type PwaCacheOptions,
  type PwaDuration,
  type PwaImageCache,
  type PwaImageCacheOptions,
  type PwaPluginOptions,
} from "./config.js";

export type { PwaCacheOptions, PwaDuration, PwaImageCache, PwaImageCacheOptions, PwaPluginOptions };

export interface FarmPwaBrowserRuntime {
  registration: ServiceWorkerRegistration;
  applyUpdate(): void;
}

export interface FarmPwaUpdateEventDetail {
  registration: ServiceWorkerRegistration;
  applyUpdate(): void;
}

declare global {
  interface Window {
    /** Browser runtime installed by `@farm.js/pwa`. */
    __FARM_PWA__?: FarmPwaBrowserRuntime;
  }
}

/**
 * Generate and register a route-aware service worker for a Farm application.
 * Build assets are always precached. Optional page and image caching stays
 * constrained to safe GET navigation and same-origin image requests.
 */
export function pwa(options: PwaPluginOptions = {}) {
  const resolved = resolvePwaOptions(options);
  let configuredBasePath = "/";
  let configuredOutputDir = ".farm/.output";
  const publicConfig = {
    enabled: resolved.enabled,
    workerUrl: "/sw.js",
    scope: "/",
    update: resolved.update,
  };

  return definePlugin({
    name: "farm:pwa",

    configure(config) {
      const basePath = normalizeBasePath(config.basePath);
      configuredBasePath = basePath;
      configuredOutputDir = `${config.root ?? "."}/.farm/.output`;
      publicConfig.workerUrl = withBasePath("/sw.js", basePath);
      publicConfig.scope = basePath === "/" ? "/" : `${basePath}/`;
    },

    build: {
      configure(nitroConfig) {
        if (!resolved.enabled) return nitroConfig;

        let generated = false;
        const hooks = nitroConfig.hooks ?? {};
        const previousPrerenderDone = hooks["prerender:done"];
        const previousRollupBefore = hooks["rollup:before"];
        const generate = async () => {
          if (generated) return;
          const built = await writePwaBuildArtifacts({
            outputDir: nitroConfig.output?.dir ?? configuredOutputDir,
            publicDir: nitroConfig.output?.publicDir,
            preset: nitroConfig.preset ?? "node-server",
            basePath: configuredBasePath,
            options: resolved,
          });
          generated = true;
          console.info(
            `[farm:pwa] Generated ${built.workerUrl} with ${built.precacheUrls.length} precached files`,
          );
        };

        return {
          ...nitroConfig,
          hooks: {
            ...hooks,
            "prerender:done": async (...args: unknown[]) => {
              await callConfiguredHooks(previousPrerenderDone, args);
              await generate();
            },
            "rollup:before": async (...args: unknown[]) => {
              await callConfiguredHooks(previousRollupBefore, args);
              if (isNitroPrerenderBuild(args[0])) return;
              await generate();
            },
          },
        };
      },
    },

    client: {
      public: publicConfig,

      async setup({ public: config, isProd }) {
        if (!config.enabled || !isProd || !("serviceWorker" in navigator)) return undefined;

        const registration = await navigator.serviceWorker.register(config.workerUrl, {
          scope: config.scope,
        });
        const hadControllerAtSetup = Boolean(navigator.serviceWorker.controller);
        let applyingUpdate = false;
        let reloading = false;

        const applyUpdate = () => {
          applyingUpdate = true;
          registration.waiting?.postMessage({ type: "FARM_PWA_SKIP_WAITING" });
        };
        const announceUpdate = () => {
          if (config.update === "auto") {
            applyUpdate();
            return;
          }
          window.dispatchEvent(
            new CustomEvent("farm:pwa:update-available", {
              detail: { registration, applyUpdate },
            }),
          );
        };
        const handleUpdateFound = () => {
          const installing = registration.installing;
          if (!installing) return;
          const handleStateChange = () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              announceUpdate();
            }
          };
          installing.addEventListener("statechange", handleStateChange);
        };
        const handleControllerChange = () => {
          window.dispatchEvent(new CustomEvent("farm:pwa:updated"));
          if (
            ((config.update === "auto" && hadControllerAtSetup) || applyingUpdate) &&
            !reloading
          ) {
            reloading = true;
            window.location.reload();
          }
        };

        registration.addEventListener("updatefound", handleUpdateFound);
        navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
        window.__FARM_PWA__ = { registration, applyUpdate };

        if (registration.waiting && navigator.serviceWorker.controller) announceUpdate();

        return {
          cleanup() {
            registration.removeEventListener("updatefound", handleUpdateFound);
            navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
            if (window.__FARM_PWA__?.registration === registration) delete window.__FARM_PWA__;
          },
        };
      },

      close({ state }) {
        state?.cleanup?.();
      },
    },
  });
}

function isNitroPrerenderBuild(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const options = (value as { options?: { preset?: unknown } }).options;
  return options?.preset === "nitro-prerender";
}

async function callConfiguredHooks(value: unknown, args: unknown[]): Promise<void> {
  const hooks = Array.isArray(value) ? value : [value];
  for (const hook of hooks) {
    if (typeof hook === "function") await hook(...args);
  }
}
