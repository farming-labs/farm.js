// A typed proxy over the shell's message bridge (RFC 0004, section 7.3). In
// phase 2 this is `@farm.js/core/native` with types generated from
// `mobile.native`; the spike keeps it in the app.
//
// Inside the Android shell, `window.__farmBridge` is injected at document
// start for the app's origin only. Everywhere else each call takes its web
// fallback or rejects with NativeUnavailableError.

export type HapticStyle = "light" | "medium" | "heavy";

export interface NativePlugins {
  haptics: {
    impact(style?: HapticStyle): Promise<{ via: "native" | "web"; style: HapticStyle }>;
  };
}

type PluginName = keyof NativePlugins;

interface FarmBridge {
  platform: string;
  has(plugin: string): boolean;
  call(plugin: string, method: string, args: unknown): Promise<unknown>;
}

declare global {
  interface Window {
    __farmBridge?: FarmBridge;
  }
}

export class NativeUnavailableError extends Error {
  readonly code = "native_unavailable";
  constructor(plugin: string, method: string) {
    super(`${plugin}.${method} is not available on this platform.`);
    this.name = "NativeUnavailableError";
  }
}

const HAPTIC_MS: Record<HapticStyle, number> = { light: 10, medium: 20, heavy: 40 };

const webFallbacks: { [P in PluginName]: NativePlugins[P] } = {
  haptics: {
    async impact(style = "light") {
      if (typeof navigator !== "undefined" && navigator.vibrate?.(HAPTIC_MS[style])) {
        return { via: "web", style };
      }
      throw new NativeUnavailableError("haptics", "impact");
    },
  },
};

// Positional arguments are mapped to the named arguments the native plugin reads.
const argNames: { [P in PluginName]: { [M in keyof NativePlugins[P]]: string[] } } = {
  haptics: { impact: ["style"] },
};

function bridge(): FarmBridge | undefined {
  return typeof window === "undefined" ? undefined : window.__farmBridge;
}

function plugin<P extends PluginName>(name: P): NativePlugins[P] & { available(): boolean } {
  return new Proxy({} as NativePlugins[P] & { available(): boolean }, {
    get(_, method: string) {
      if (method === "available") return () => Boolean(bridge()?.has(name));
      return (...args: unknown[]) => {
        const native = bridge();
        const fallback = (webFallbacks[name] as Record<string, (...a: unknown[]) => unknown>)[method];
        if (native?.has(name)) {
          const names = (argNames[name] as Record<string, string[]>)[method] ?? [];
          const named = Object.fromEntries(names.map((key, i) => [key, args[i]]));
          return native.call(name, method, named);
        }
        if (fallback) return fallback(...args);
        return Promise.reject(new NativeUnavailableError(name, method));
      };
    },
  });
}

export const native: { [P in PluginName]: NativePlugins[P] & { available(): boolean } } = {
  haptics: plugin("haptics"),
};
