export interface WasmOptions {
  /**
   * Browser compilation target. Must support native top-level await and module workers.
   * Overrides vite.build.target for browser builds only; server targets are unchanged.
   * Uses vite.build.target when supplied, otherwise Chrome/Edge 89,
   * Firefox 114, and Safari 15. Does not polyfill browser runtime limitations.
   */
  target?: string | string[];
}

export const DEFAULT_WASM_TARGET = ["chrome89", "edge89", "firefox114", "safari15"];

export function resolveWasmOptions(options: WasmOptions): WasmOptions {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("[farm:wasm] Options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (key !== "target") {
      throw new TypeError(
        `[farm:wasm] Unknown option ${JSON.stringify(key)}. The supported option is target.`,
      );
    }
  }
  const target = options.target;
  if (target === undefined) return {};
  const targets = Array.isArray(target) ? target : [target];
  if (
    targets.length === 0 ||
    targets.some((value) => typeof value !== "string" || value.trim() === "")
  ) {
    throw new TypeError(
      "[farm:wasm] target must be a non-empty browser target or array of browser targets",
    );
  }
  return { target: Array.isArray(target) ? [...target] : target };
}
