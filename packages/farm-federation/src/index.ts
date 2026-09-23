import { definePlugin } from "@farm.js/core/plugin";
import {
  resolveFederationOptions,
  type FederationOptions,
  type FederationRemote,
  type FederationSharedOptions,
  type FederationSharedPackage,
  type FederationSharedPackages,
} from "./config.js";
import { createFarmFederationVitePlugins } from "./vite.js";

export type {
  FederationOptions,
  FederationRemote,
  FederationSharedOptions,
  FederationSharedPackage,
  FederationSharedPackages,
};

/** Publish and consume independently deployed browser modules from a Farm application. */
export function federation(options: FederationOptions) {
  return definePlugin({
    name: "farm:federation",
    enforce: "post",

    configure(config) {
      if (
        (config.plugins ?? []).filter((candidate) => candidate.name === "farm:federation").length >
        1
      ) {
        throw new Error("[farm:federation] Configure federation in one federation() instance");
      }

      const renderer = config.renderer ?? { name: "react", dedupe: ["react", "react-dom"] };
      const resolved = resolveFederationOptions(options, renderer);
      const vite = config.vite ?? {};
      return {
        ...config,
        vite: {
          ...vite,
          plugins: [...(vite.plugins ?? []), ...createFarmFederationVitePlugins(resolved)],
        },
      };
    },
  });
}
