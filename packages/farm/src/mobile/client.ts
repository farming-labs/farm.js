"use client";

import {
  delegateNavigation,
  type FarmNavigationDelegateContext,
} from "../client/navigation-delegate";
import type { FarmClientPlugin } from "../client/plugin";

/** The part of the native shell's injected `window.__farmBridge` the client uses. */
interface FarmMobileShellBridge {
  /** Show the navigation natively and return true, or return false to navigate in place. */
  offerNavigation?(context: FarmNavigationDelegateContext): boolean;
}

/**
 * @internal Inside the native shell, whose bridge script runs before the page, hand in-app
 * navigations to the shell's navigator. In a browser there is no bridge and it does nothing.
 * Returns the delegate's removal, or undefined when there is no bridge.
 */
export function installFarmMobileShellNavigation(): (() => void) | undefined {
  const bridge = (globalThis as { __farmBridge?: FarmMobileShellBridge }).__farmBridge;
  const offer = bridge?.offerNavigation;
  if (typeof offer !== "function") return undefined;
  return delegateNavigation((context) => offer.call(bridge, context) === true);
}

/**
 * @internal The client plugin a mobile client build registers (see
 * `installFarmMobileShellNavigation`). The RSC pipeline, which has no client plugins, calls
 * `installFarmMobileShellNavigation` from its mobile entry instead.
 */
export const farmMobileShellClient: FarmClientPlugin<(() => void) | undefined> = {
  setup() {
    return installFarmMobileShellNavigation();
  },
  close({ state }) {
    state?.();
  },
};
