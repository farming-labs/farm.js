import type { ResolvedFarmMCPConfig } from "../mcp-config";

/**
 * Runtime source that remounts the top-level `mcp` configuration in a built server.
 *
 * Production re-evaluates raw layer and application config modules instead of
 * calling `resolveConfig`, so the internal plugin created during the build is
 * not otherwise present in the runtime plugin list. The literal import keeps
 * the optional MCP package traceable for server and edge bundles while disabled
 * applications carry no import or runtime code.
 *
 * Shared by core's Nitro entry and the RSC entry.
 */
export function generateNativeMCPPluginSource(mcp: ResolvedFarmMCPConfig | undefined): {
  importSource: string;
  registerSource: string;
  pluginSource: string;
} {
  if (mcp?.enabled !== true) {
    return { importSource: "", registerSource: "", pluginSource: "" };
  }

  return {
    importSource: `import { createFarmMCPPlugin as __farmCreateMCPPlugin } from "@farm.js/mcp/internal";`,
    registerSource: `function __farmMCPIsPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function __farmMergeMCPConfig(base, override) {
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    output[key] =
      __farmMCPIsPlainObject(output[key]) && __farmMCPIsPlainObject(value)
        ? __farmMergeMCPConfig(output[key], value)
        : value;
  }
  return output;
}

const farmNativeMCPConfig = farmRuntimeConfigs.reduce((merged, runtimeConfig) => {
  const value = runtimeConfig?.mcp;
  if (value === undefined) return merged;
  if (value === false) return false;
  return __farmMergeMCPConfig(merged && merged !== false ? merged : {}, value);
}, undefined);
const farmNativeMCPPlugin =
  farmNativeMCPConfig && farmNativeMCPConfig.enabled !== false
    ? __farmCreateMCPPlugin(farmNativeMCPConfig)
    : null;`,
    pluginSource: `...(farmNativeMCPPlugin ? [farmNativeMCPPlugin] : []),`,
  };
}
