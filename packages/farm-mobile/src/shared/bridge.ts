import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FarmMobileOS } from "@farm.js/core/mobile";

/** The one bridge script every shell injects, filled in per OS when its project is generated. */
export const BRIDGE_TEMPLATE = fileURLToPath(
  new URL("../../templates/shared/farm-bridge.js", import.meta.url),
);

/**
 * How the page reaches native: Android's WebMessageListener object, or the iOS
 * WKScriptMessageHandler. Both take JSON strings, so native parses the same messages.
 */
const NATIVE_PORTS: Record<FarmMobileOS, string> = {
  android: "window.FarmNative",
  ios: "window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.farmNative",
};

/**
 * `farm-bridge.js` for one OS: the shell name (`data-farm-shell`, `__farmBridge.platform`) and the
 * message port. `__FARM_PLUGINS__` stays for native code to fill in at launch.
 */
export async function createBridgeScript(os: FarmMobileOS): Promise<string> {
  const source = await readFile(BRIDGE_TEMPLATE, "utf8");
  return source
    .replaceAll("__FARM_SHELL_OS__", JSON.stringify(os))
    .replaceAll("__FARM_NATIVE_PORT__", NATIVE_PORTS[os]);
}
